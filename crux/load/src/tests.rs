//! The script as it goes inline, its tag for a view, and the hash a policy allows it by. What it measures and sends,
//! in Chrome, is load.test.mts's.

use super::*;

#[test]
fn the_script_is_one_line_that_stays_in_its_element() {
    let script = script();
    assert!(
        script.starts_with("(()=>{") && script.ends_with("})();"),
        "{script}"
    );
    assert!(!script.contains('\n'), "{script}");
    // Nothing in it ends the element it is in, nor reads as the start of a comment.
    assert!(
        !script.contains("</") && !script.contains("<!--"),
        "{script}"
    );
    // What a page sends, and where.
    for said in ["/nerd/event", "sendBeacon", "nerdLoad", "data", "load.cls"] {
        assert!(script.contains(said), "{said} is not in {script}");
    }
    // Small, as it is in every page.
    assert!(script.len() < 2048, "{} bytes", script.len());
}

#[test]
fn a_tag_is_the_script_with_its_view() {
    assert_eq!(
        tag("post"),
        format!("<script data-view=\"post\">{}</script>", script())
    );
    for view in [
        "home",
        "a",
        "archive.2025",
        "sign-in",
        "x_y",
        &"v".repeat(56),
    ] {
        assert!(tag(view).starts_with(&format!("<script data-view=\"{view}\">")));
    }
}

#[test]
fn a_view_not_of_nerds_shape_is_refused() {
    for view in [
        "",
        "Post",
        "a b",
        ".post",
        "post\"><script>alert(1)</script>",
        "pösts",
        &"v".repeat(57),
    ] {
        let tagged = std::panic::catch_unwind(|| tag(view));
        assert!(tagged.is_err(), "{view:?} was let be");
    }
}

#[test]
fn the_hash_is_of_the_script_inline() {
    // A digest worked out apart from this crate: `printf %s 'alert(1);' | openssl dgst -sha256 -binary | base64`.
    assert_eq!(
        hash_of("alert(1);"),
        "sha256-5jFwrAK0UV47oFbVg/iCCBbxD8X1w+QvoOUepu4C2YA="
    );
    assert_eq!(hash(), hash_of(script()));
    let inline = tag("home");
    let inline = &inline["<script data-view=\"home\">".len()..inline.len() - "</script>".len()];
    assert_eq!(hash(), hash_of(inline));
}

#[test]
fn the_file_is_the_script() {
    let file = file();
    assert_eq!(file.path, PATH);
    assert_eq!(file.content_type, CONTENT_TYPE);
    assert_eq!(file.body, script().as_bytes());
}
