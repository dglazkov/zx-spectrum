//! Searching the ZXDB's own index, as the server answers from it: the index web/tools/zxdb-index.mjs builds from the
//! dump's excerpt (tests/zxdb-index.txt; web/tests/zxdb.test.mjs holds it to what the tool builds), against ZXInfo's
//! own answers (web/tests/fixtures/zxinfo/). Ported from the block "searching the index" of web/tests/zxdb.test.mjs.

use std::collections::BTreeSet;

use app::zxdb::{normalise, Index, Zxdb};
use serde_json::Value;

const INDEX: &[u8] = include_bytes!("zxdb-index.txt");

fn index() -> Index {
    Index::read(INDEX.to_vec()).unwrap()
}

fn search(index: &Index, query: &str) -> Value {
    serde_json::from_slice(&index.search(query)).unwrap()
}

fn ids(index: &Index, query: &str) -> Vec<String> {
    let r = search(index, query);
    r["hits"]["hits"].as_array().unwrap().iter().map(|h| h["_id"].as_str().unwrap().to_string()).collect()
}

fn recording(name: &str) -> Value {
    let path = format!("{}/../../web/tests/fixtures/zxinfo/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn finds_saboteur_first_for_saboteur_as_zxinfo_does_then_its_sequels() {
    let index = index();
    let r = search(&index, "query=Saboteur&size=24&availability=Available");
    assert_eq!(r["answeredBy"], "zxdb-index");
    assert_eq!(r["source"], "the excerpt");
    assert_eq!(r["hits"]["hits"][0]["_id"], "0004293");
    assert_eq!(r["hits"]["hits"][0]["_source"]["title"], "Saboteur!");
    let recorded = recording("search-saboteur");
    assert_eq!(r["hits"]["total"]["value"], recorded["hits"]["total"]["value"]);
    let theirs: BTreeSet<String> = recorded["hits"]["hits"].as_array().unwrap().iter().map(|h| h["_id"].as_str().unwrap().to_string()).collect();
    assert_eq!(ids(&index, "query=Saboteur&availability=Available").into_iter().collect::<BTreeSet<_>>(), theirs);
}

#[test]
fn matches_however_the_title_is_written_case_accents_punctuation_the_start_of_a_word_another_title() {
    let index = index();
    assert_eq!(ids(&index, "query=SABOT%C3%89UR")[0], "0004293");
    let mut first_two = ids(&index, "query=sabot")[..2].to_vec();
    first_two.sort();
    assert_eq!(first_two, ["0004293", "0004295"]);
    assert!(ids(&index, "query=saboteur%202").contains(&"0004295".to_string()));
    assert_eq!(ids(&index, "query=avenging%20angel"), ["0004295"]);
    assert!(ids(&index, "query=jet-set").contains(&"0002589".to_string()));
    assert_eq!(normalise("Saboteur II: Avenging Angel"), "saboteur ii avenging angel");
}

// Not among web/tests/zxdb.test.mjs's: the order itself, which its cases left to chance where a rule only reorders.
#[test]
fn orders_the_closest_first_then_the_most_released_then_the_shortest_title() {
    let index = index();
    // All begin with "sabot" but the hunt, whose second word does: the sequel released most, then the original, then
    // by their titles' length.
    assert_eq!(ids(&index, "query=sabot"), ["0004295", "0004293", "0027034", "0042977", "0042978", "0041308"]);
    // A title beginning with it; then a word of a title (Jet Set Willy, Hunt Saboteur); then the publisher's alone.
    assert_eq!(ids(&index, "query=s"), ["0004295", "0004293", "0027034", "0042977", "0042978", "0002589", "0041308", "0000958", "0002514", "0014957"]);
}

#[test]
fn finds_by_publisher_too_after_titles() {
    assert!(ids(&index(), "query=durell").contains(&"0004293".to_string()));
}

#[test]
fn keeps_to_what_is_available_where_asked_and_counts_the_rest_where_not() {
    let index = index();
    assert_eq!(ids(&index, "query=chuckie%20egg&availability=Available"), Vec::<String>::new());
    assert_eq!(ids(&index, "query=chuckie%20egg"), ["0000958"]);
}

#[test]
fn pages_by_size_and_offset_and_finds_nothing_for_nothing() {
    let index = index();
    let all = ids(&index, "query=saboteur&size=24");
    assert_eq!(ids(&index, "query=saboteur&size=2&offset=1"), all[1..3]);
    let none = search(&index, "query=saboteur&size=0");
    assert_eq!(none["hits"], serde_json::json!({ "total": { "value": all.len(), "relation": "eq" }, "hits": [] }));
    assert_eq!(ids(&index, "query=%20%21"), Vec::<String>::new());
}

#[test]
fn answers_an_entry_by_its_id_however_it_is_padded_and_says_what_it_has_not() {
    let zxdb = Zxdb::of(INDEX);
    for path in ["/games/0004293", "/games/4293", "/games/04293"] {
        let (status, json) = zxdb.answer(path, "mode=compact").unwrap();
        let entry: Value = serde_json::from_slice(&json).unwrap();
        assert_eq!((status, entry["_id"].as_str(), entry["found"].as_bool()), (200, Some("0004293"), Some(true)), "{path}");
        assert_eq!(entry["_source"]["title"], "Saboteur!");
    }
    let (status, json) = zxdb.answer("/games/0999999", "").unwrap();
    assert_eq!(status, 404);
    assert_eq!(serde_json::from_slice::<Value>(&json).unwrap()["found"], false);
    assert_eq!(zxdb.answer("/suggest/sabot", ""), None);
    // Gzipped, as the image has it, the same.
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    std::io::Write::write_all(&mut gz, INDEX).unwrap();
    assert_eq!(Zxdb::of(gz.finish().unwrap()).answer("/games/4293", ""), zxdb.answer("/games/4293", ""));
    // And no index, no answer.
    assert_eq!(Zxdb::at("/nonexistent/zxdb-index.txt.gz").answer("/search", "query=saboteur"), None);
}
