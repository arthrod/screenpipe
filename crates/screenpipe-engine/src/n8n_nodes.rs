// screenpipe — AI that knows everything you've seen, said, or heard
// https://screenpipe.com

//! The nodes this n8n has, as the chat looks them up before building a Flow:
//! a search over every node type, and the card of one type (its parameters
//! with allowed values, display rules and nested fields, the credentials it
//! needs and a node skeleton to start from).
//!
//! The data is the browsing layer of the node catalog,
//! `infra/automation-flows/n8n-nodes.json.gz`, written by `n8n-catalog.ts`
//! from the same n8n image as the check layer [`crate::flow_checks`] reads,
//! so what the chat finds is what the check accepts. Switched-off types
//! (Execute Command, Local File Trigger) are listed, flagged, never usable.
//!
//! Size: about 600 KiB gzipped (5 MiB of JSON). Only the search index stays
//! in memory; a card is read from a fresh decompression, which the chat asks
//! for a few times per Flow.

use crate::flow_checks::{skeleton_parameters, N8nCredential};
use serde::de::IgnoredAny;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::io::Read;
use std::sync::OnceLock;

const BROWSING_GZ: &[u8] = include_bytes!("../../../infra/automation-flows/n8n-nodes.json.gz");
/// A search answers with at most this many entries, best first.
pub const MAX_RESULTS: usize = 20;
/// Parameters that choose which other parameters a node shows.
const SELECTORS: [&str; 2] = ["resource", "operation"];
const SWITCHED_OFF: &str = "switched off here: no Flow can use it, and no other node does the same; tell the user this n8n cannot do that";

#[derive(Deserialize)]
struct Browsing {
    index: Vec<Entry>,
    #[allow(dead_code)]
    details: IgnoredAny,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    kind: String,
    name: String,
    description: String,
    version: f64,
    #[serde(default)]
    trigger: bool,
    credentials: Vec<String>,
    #[serde(default)]
    aliases: Vec<String>,
    #[serde(rename = "toolOf")]
    tool_of: Option<String>,
    #[serde(default)]
    off: bool,
}

impl Entry {
    fn summary(&self) -> Value {
        let mut entry = json!({
            "type": self.kind,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "credentials": self.credentials,
        });
        if self.trigger {
            entry["trigger"] = json!(true);
        }
        if let Some(node) = &self.tool_of {
            entry["toolOf"] = json!(node);
        }
        if self.off {
            entry["switchedOff"] = json!(true);
            entry["note"] = json!(SWITCHED_OFF);
        }
        entry
    }

    /// How well every word of a search matches; `None` when one does not.
    fn score(&self, words: &[String]) -> Option<u32> {
        let name = self.name.to_lowercase();
        let short_type = self
            .kind
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_lowercase();
        let aliases = self.aliases.join(" ").to_lowercase();
        let description = self.description.to_lowercase();
        let mut score = 0;
        for word in words {
            score += if name.split_whitespace().any(|part| part == word) {
                10
            } else if name.contains(word.as_str()) {
                6
            } else if short_type.contains(word.as_str()) {
                5
            } else if aliases.contains(word.as_str()) {
                4
            } else if description.contains(word.as_str()) {
                1
            } else {
                return None;
            };
        }
        if name == words.join(" ") {
            score += 20;
        }
        Some(score)
    }
}

fn unpacked() -> String {
    let mut text = String::new();
    flate2::read::GzDecoder::new(BROWSING_GZ)
        .read_to_string(&mut text)
        .expect("n8n-nodes.json.gz is valid gzip");
    text
}

fn index() -> &'static [Entry] {
    static INDEX: OnceLock<Vec<Entry>> = OnceLock::new();
    INDEX.get_or_init(|| {
        serde_json::from_str::<Browsing>(&unpacked())
            .expect("n8n-nodes.json.gz is valid")
            .index
    })
}

/// One type's card in the browsing layer. The generator writes one card per
/// line, `"<type>":{…}`, so a card is found without parsing the others.
fn detail(text: &str, kind: &str) -> Option<Value> {
    let key = format!("\n{}:", serde_json::to_string(kind).ok()?);
    let start = text.find(&key)? + key.len();
    let line = text[start..].split('\n').next()?;
    serde_json::from_str(line.trim_end_matches(',')).ok()
}

/// At most [`MAX_RESULTS`] entries matching every word of `query`, best
/// first, and how many matched. `Err` when the query has no word.
pub fn search(query: &str) -> Result<Value, String> {
    let words: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_string)
        .collect();
    if words.is_empty() {
        return Err("send `q`: words to look for in node names and descriptions".into());
    }
    let mut matched: Vec<(u32, &Entry)> = index()
        .iter()
        .filter_map(|entry| Some((entry.score(&words)?, entry)))
        .collect();
    // A node before its AI-tool twin, then by name.
    matched.sort_by(|(a, x), (b, y)| {
        b.cmp(a)
            .then(x.tool_of.is_some().cmp(&y.tool_of.is_some()))
            .then(x.name.cmp(&y.name))
    });
    let results: Vec<Value> = matched
        .iter()
        .take(MAX_RESULTS)
        .map(|(_, entry)| entry.summary())
        .collect();
    Ok(json!({"results": results, "total": matched.len()}))
}

/// The card of `kind`, narrowed to the chosen `resource` and `operation`
/// (`chosen`), without the credential state (see [`add_credential_state`]).
/// `Ok(None)` for a type this n8n does not have; `Err` for a choice the node
/// does not offer.
pub fn card(kind: &str, chosen: &Map<String, Value>) -> Result<Option<Value>, String> {
    let Some(entry) = index().iter().find(|entry| entry.kind == kind) else {
        return Ok(None);
    };
    let mut card = entry.summary();
    if entry.off {
        return Ok(Some(card));
    }
    let Some(detail) = detail(&unpacked(), entry.tool_of.as_deref().unwrap_or(kind)) else {
        return Ok(None);
    };
    let properties = detail["properties"].as_array().cloned().unwrap_or_default();
    let (properties, narrowed) = narrow(properties, chosen)?;
    card["properties"] = json!(properties);
    if !narrowed.is_empty() {
        card["fieldsHidden"] = json!(format!(
            "this node shows other fields for each {}: read the card again with them (values above) to see those fields",
            narrowed.join(" and ")
        ));
    }
    card["credentials"] = json!(detail["credentials"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|credential| {
            let mut credential = credential.clone();
            if let Some(fields) = credential.as_object_mut() {
                if let Some(name) = fields.remove("name") {
                    fields.insert("type".into(), name);
                }
            }
            credential
        })
        .collect::<Vec<_>>());
    if let Some(parameters) = skeleton_parameters(kind, entry.version, chosen) {
        card["skeleton"] = json!({
            "name": entry.name,
            "type": kind,
            "typeVersion": entry.version,
            "position": [0, 0],
            "parameters": parameters,
            "notes": "",
        });
    }
    Ok(Some(card))
}

/// Keeps the parameters shown for the chosen selectors. A parameter that
/// depends on a selector not chosen is left out, except the selectors' own
/// menus. Returns the selectors left unchosen that hid parameters.
fn narrow(
    properties: Vec<Value>,
    chosen: &Map<String, Value>,
) -> Result<(Vec<Value>, Vec<&'static str>), String> {
    let has = |name: &str| properties.iter().any(|p| p["name"] == name);
    if let Some(unknown) = chosen.keys().find(|key| !has(key)) {
        return Err(format!("this node has no `{unknown}` parameter"));
    }
    let rule = |property: &Value, selector: &str| -> Option<Vec<Value>> {
        let show = &property["show"];
        show.get(selector)
            .or_else(|| show.get(format!("/{selector}")))
            .and_then(Value::as_array)
            .cloned()
    };
    let mut hidden = Vec::new();
    let kept: Vec<Value> = properties
        .iter()
        .filter(|property| {
            // Every selector is read (no short-circuit): each one that hides
            // this parameter is reported.
            let verdicts: Vec<bool> = SELECTORS
                .iter()
                .filter(|s| has(s))
                .map(
                    |selector| match (rule(property, selector), chosen.get(*selector)) {
                        (None, _) => true,
                        (Some(allowed), Some(value)) => allowed.contains(value),
                        (Some(_), None) => {
                            let menu =
                                SELECTORS.contains(&property["name"].as_str().unwrap_or_default());
                            if !menu && !hidden.contains(selector) {
                                hidden.push(*selector);
                            }
                            menu
                        }
                    },
                )
                .collect();
            verdicts.into_iter().all(|keep| keep)
        })
        .cloned()
        .collect();
    for (selector, value) in chosen {
        let offered: Vec<&Value> = kept
            .iter()
            .filter(|p| p["name"] == selector.as_str())
            .flat_map(|p| p["options"].as_array().into_iter().flatten())
            .map(|option| option.get("value").unwrap_or(option))
            .collect();
        if !offered.contains(&value) {
            let values: Vec<String> = offered.iter().map(|v| v.to_string()).collect();
            return Err(format!(
                "`{selector}` has no value {value} here (values: {})",
                values.join(", ")
            ));
        }
    }
    hidden.sort_by_key(|selector| SELECTORS.iter().position(|s| s == selector));
    Ok((kept, hidden))
}

/// Says, for each credential type the card lists, whether n8n holds none,
/// one (named) or several of it, as the check will treat it.
pub fn add_credential_state(card: &mut Value, held: &[N8nCredential]) {
    for credential in card["credentials"].as_array_mut().into_iter().flatten() {
        let kind = credential["type"].as_str().unwrap_or_default().to_string();
        let of_kind: Vec<&N8nCredential> = held.iter().filter(|c| c.kind == kind).collect();
        match of_kind.as_slice() {
            [] => {
                credential["inN8n"] = json!("none");
                credential["note"] = json!(
                    "n8n holds none: the user must create it in n8n before a Flow can use this node"
                );
            }
            [only] => {
                credential["inN8n"] = json!("one");
                credential["name"] = json!(only.name);
                credential["note"] = json!("ScreenPipe wires it; never name a credential yourself");
            }
            several => {
                credential["inN8n"] = json!("several");
                credential["names"] = json!(several.iter().map(|c| &c.name).collect::<Vec<_>>());
                credential["note"] = json!(
                    "ScreenPipe does not choose between the user's accounts: the user picks one on the node in n8n"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_usable_type_has_a_card_and_a_skeleton_the_check_knows() {
        let text = unpacked();
        for entry in index().iter().filter(|entry| !entry.off) {
            let source = entry.tool_of.as_deref().unwrap_or(&entry.kind);
            assert!(
                detail(&text, source).is_some(),
                "{} has no card",
                entry.kind
            );
            assert!(
                skeleton_parameters(&entry.kind, entry.version, &Map::new()).is_some(),
                "{} {} is unknown to the check layer",
                entry.kind,
                entry.version
            );
        }
    }
}
