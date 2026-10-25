//! The ZXDB's own index (built by `web/tools/zxdb-index.mjs` from the ZXDB's dump, and put beside the server in the
//! image), answering as the ZXInfo API answers the page, for the paths the page asks (`web/src/library/zxinfo.ts`):
//!
//!   /search?query=…&size=…&offset=…&availability=Available   by title (and other titles) and publisher, the closest first
//!   /games/<id>                                              one entry, by its ZXDB id
//!
//! The pass-through answers from it where the API cannot ([`crate::pass`]): ZXInfo stays the first choice. Its answers
//! carry `"answeredBy": "zxdb-index"` and the dump's `source`.
//!
//! The index's text (`indexText` in `web/zxdb.mjs` writes it, gzipped): a line of JSON saying where it came from, then
//! a line an entry, its key and its answer apart by a tab: the key `[id, availability, releases with files, titles as
//! words, publisher as words]`, and the API's `_source` for it, kept as the UTF-8 it is and sent as it is.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::ops::Range;
use std::path::PathBuf;
use std::sync::{LazyLock, OnceLock};

use regex::Regex;
use unicode_normalization::UnicodeNormalization;

/// Lower case, no accents, words of letters and digits only: "Saboteur II: Avenging Angel" is "saboteur ii avenging
/// angel", as `normalise` in `web/zxdb.mjs` writes the index's titles.
pub fn normalise(text: &str) -> String {
    static NOT_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[^\p{L}\p{N}]+").unwrap());
    let bare: String = text.nfkd().filter(|c| !('\u{300}'..='\u{36f}').contains(c)).collect();
    NOT_WORD.replace_all(&bare.to_lowercase(), " ").trim().to_string()
}

/// An entry's key, and where its answer is in the index's bytes.
struct Key {
    id: String,
    availability: Option<String>,
    releases: i64,
    titles: Vec<String>,
    words: Vec<String>,
    publisher: Vec<String>,
    json: Range<usize>,
}

/// An index, read.
pub struct Index {
    source: serde_json::Value,
    bytes: Vec<u8>,
    keys: Vec<Key>,
    by_id: HashMap<String, usize>,
}

impl Index {
    /// The index in `text`, gzipped or not; what is not an index is said so.
    pub fn read(text: Vec<u8>) -> Result<Index, String> {
        let bytes = match text.starts_with(&[0x1f, 0x8b]) {
            true => {
                let mut out = Vec::new();
                flate2::read::GzDecoder::new(&text[..]).read_to_end(&mut out).map_err(|e| format!("not gzip: {e}"))?;
                out
            }
            false => text,
        };
        let mut lines = LineRanges { bytes: &bytes, at: 0 };
        let first = lines.next().ok_or("empty")?;
        let head: serde_json::Value = serde_json::from_slice(&bytes[first]).map_err(|e| format!("its first line: {e}"))?;
        let source = head.get("source").cloned().unwrap_or(serde_json::Value::Null);
        let mut keys = Vec::new();
        let mut by_id = HashMap::new();
        for line in lines {
            if line.is_empty() {
                continue;
            }
            let tab = bytes[line.clone()].iter().position(|&b| b == b'\t').ok_or("a line with no tab")? + line.start;
            type Raw = (String, Option<String>, i64, Vec<String>, Vec<String>);
            let (id, availability, releases, titles, publisher): Raw =
                serde_json::from_slice(&bytes[line.start..tab]).map_err(|e| format!("a key: {e}"))?;
            let mut seen = HashSet::new();
            let words = titles.join(" ").split(' ').filter(|w| seen.insert(w.to_string())).map(str::to_string).collect();
            by_id.insert(id.clone(), keys.len());
            keys.push(Key { id, availability, releases, titles, words, publisher, json: tab + 1..line.end });
        }
        Ok(Index { source, bytes, keys, by_id })
    }

    /// How many entries it has.
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    fn head(&self) -> String {
        format!("\"answeredBy\":\"zxdb-index\",\"source\":{}", self.source)
    }

    /// A search, as the API's /search answers it (hits.total.value, and hits.hits of {_id, _source}), as JSON in
    /// UTF-8, from its query string.
    pub fn search(&self, raw_query: &str) -> Vec<u8> {
        let params: Vec<(String, String)> = form_urlencoded::parse(raw_query.as_bytes()).into_owned().collect();
        let get = |name: &str| params.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str());
        let query = normalise(get("query").unwrap_or(""));
        let words: Vec<&str> = query.split(' ').filter(|w| !w.is_empty()).collect();
        let size = number(get("size"), 25.0).clamp(0.0, 100.0);
        let offset = number(get("offset"), 0.0).max(0.0);
        let available = get("availability").filter(|a| !a.is_empty());
        let mut found: Vec<(u8, &Key)> = Vec::new();
        if !words.is_empty() {
            for key in &self.keys {
                if available.is_some() && key.availability.as_deref() != available {
                    continue;
                }
                if let Some(c) = closeness(key, &query, &words) {
                    found.push((c, key));
                }
            }
        }
        // The closest first; then the one released most often (the game people knew, before a fan's remake), then the
        // shorter title (the game before its sequels and editions), then the older entry.
        let length = |k: &Key| k.titles.first().map_or(0, |t| t.encode_utf16().count());
        found.sort_by(|(ca, a), (cb, b)| {
            ca.cmp(cb).then(b.releases.cmp(&a.releases)).then(length(a).cmp(&length(b))).then(a.id.cmp(&b.id))
        });
        let start = (offset.trunc() as usize).min(found.len());
        let end = ((offset + size).trunc() as usize).clamp(start, found.len());
        let mut out = format!("{{{},\"hits\":{{\"total\":{{\"value\":{},\"relation\":\"eq\"}},\"hits\":[", self.head(), found.len())
            .into_bytes();
        for (i, (_, key)) in found[start..end].iter().enumerate() {
            out.extend_from_slice(format!("{}{{\"_id\":\"{}\",\"_source\":", if i > 0 { "," } else { "" }, key.id).as_bytes());
            out.extend_from_slice(&self.bytes[key.json.clone()]);
            out.push(b'}');
        }
        out.extend_from_slice(b"]}}");
        out
    }

    /// One entry, as the API's /games/<id> answers it, as JSON in UTF-8; none where the index has none.
    pub fn entry(&self, id: &str) -> Option<Vec<u8>> {
        let id = format!("{:0>7}", id.trim_start_matches('0'));
        let key = &self.keys[*self.by_id.get(&id)?];
        let mut out = format!("{{{},\"_id\":\"{}\",\"found\":true,\"_source\":", self.head(), key.id).into_bytes();
        out.extend_from_slice(&self.bytes[key.json.clone()]);
        out.push(b'}');
        Some(out)
    }

    /// What it answers for an API path (as the pass-through passes it: "/search", "/games/0004293") and its query
    /// string: a status and JSON, or none for a path it does not answer (the API's /suggest).
    pub fn answer(&self, api_path: &str, raw_query: &str) -> Option<(u16, Vec<u8>)> {
        static GAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^/games/([0-9]{1,7})$").unwrap());
        if api_path == "/search" {
            return Some((200, self.search(raw_query)));
        }
        let id = GAME.captures(api_path)?.get(1)?.as_str();
        Some(match self.entry(id) {
            Some(json) => (200, json),
            None => (404, format!("{{{},\"found\":false}}", self.head()).into_bytes()),
        })
    }
}

/// The lines of `bytes`, as ranges, without their newlines.
struct LineRanges<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Iterator for LineRanges<'_> {
    type Item = Range<usize>;

    fn next(&mut self) -> Option<Range<usize>> {
        if self.at >= self.bytes.len() {
            return None;
        }
        let start = self.at;
        let end = self.bytes[start..].iter().position(|&b| b == b'\n').map_or(self.bytes.len(), |n| start + n);
        self.at = end + 1;
        Some(start..end)
    }
}

/// A number from a query, as JavaScript's `Number(x) || 0` reads it: `default` where it is not given, 0 where it is
/// empty or not a number.
fn number(text: Option<&str>, default: f64) -> f64 {
    let Some(text) = text else { return default };
    let text = text.trim();
    let n = match text.is_empty() {
        true => 0.0,
        false => text.parse::<f64>().unwrap_or(f64::NAN),
    };
    if n.is_nan() { 0.0 } else { n }
}

fn prefix_of(words: &[String], w: &str) -> bool {
    words.iter().any(|x| x.starts_with(w))
}

/// How close an entry is to the query's words, smaller the closer, or none for no match: its title the query (0), its
/// title beginning with it (1), every word the start of a word of a title (2), or of the publisher's name (3).
fn closeness(key: &Key, query: &str, words: &[&str]) -> Option<u8> {
    if key.titles.iter().any(|t| t == query) {
        return Some(0);
    }
    if key.titles.iter().any(|t| t.starts_with(query)) {
        return Some(1);
    }
    if words.iter().all(|w| prefix_of(&key.words, w)) {
        return Some(2);
    }
    if words.iter().all(|w| prefix_of(&key.words, w) || prefix_of(&key.publisher, w)) {
        return Some(3);
    }
    None
}

/// Where an index is, read the first time it is asked for: what is not there, or not an index, is no index, and the
/// pass-through answers as it would without one (said once, as it is read).
pub struct Zxdb {
    from: From,
    index: OnceLock<Option<Index>>,
}

enum From {
    Path(PathBuf),
    Text(Vec<u8>),
}

impl Zxdb {
    /// The index at `path`, as the image puts it beside the server.
    pub fn at(path: impl Into<PathBuf>) -> Zxdb {
        Zxdb { from: From::Path(path.into()), index: OnceLock::new() }
    }

    /// The index in `text`, as a test gives it.
    pub fn of(text: impl Into<Vec<u8>>) -> Zxdb {
        Zxdb { from: From::Text(text.into()), index: OnceLock::new() }
    }

    /// The index, read the first time.
    pub fn index(&self) -> Option<&Index> {
        self.index
            .get_or_init(|| {
                let (text, from) = match &self.from {
                    From::Path(path) => match std::fs::read(path) {
                        Ok(text) => (text, path.display().to_string()),
                        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
                        Err(e) => {
                            eprintln!("zxdb: {}: {e}", path.display());
                            return None;
                        }
                    },
                    From::Text(text) => (text.clone(), "the index given".into()),
                };
                match Index::read(text) {
                    Ok(index) => Some(index),
                    Err(e) => {
                        eprintln!("zxdb: {from} is not an index: {e}");
                        None
                    }
                }
            })
            .as_ref()
    }

    /// What the index answers for an API path and its query string, or none where it has no answer, or there is
    /// no index.
    pub fn answer(&self, api_path: &str, raw_query: &str) -> Option<(u16, Vec<u8>)> {
        self.index()?.answer(api_path, raw_query)
    }
}
