use serde_json::Value;

use crate::output::{CliError, CliResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SegmentKind {
    Field,
    ArrayItems,
}

#[derive(Debug, Clone)]
struct Segment {
    name: String,
    kind: SegmentKind,
}

pub fn apply(value: &Value, expression: &str) -> CliResult<Value> {
    let expression = expression.trim();
    if expression.is_empty() || expression == "." {
        return Ok(value.clone());
    }
    let segments = parse_segments(expression)?;
    let mut current = vec![value.clone()];
    for segment in segments {
        let mut next = Vec::new();
        for item in current {
            let child = item.get(&segment.name).ok_or_else(|| {
                CliError::validation(format!("jq path not found: {}", segment.name))
            })?;
            match segment.kind {
                SegmentKind::Field => next.push(child.clone()),
                SegmentKind::ArrayItems => {
                    let array = child.as_array().ok_or_else(|| {
                        CliError::validation(format!("jq path is not an array: {}", segment.name))
                    })?;
                    next.extend(array.iter().cloned());
                }
            }
        }
        current = next;
    }
    if current.len() == 1 {
        let mut values = current;
        Ok(values.remove(0))
    } else {
        Ok(Value::Array(current))
    }
}

fn parse_segments(expression: &str) -> CliResult<Vec<Segment>> {
    if !expression.starts_with('.') {
        return Err(CliError::validation("jq expression must start with `.`"));
    }
    if expression.contains('|') || expression.contains("select(") {
        return Err(CliError::validation(
            "this CLI supports dot paths and [] expansion; complex jq filters are not available yet",
        ));
    }
    let raw = expression.trim_start_matches('.');
    if raw.is_empty() {
        return Ok(Vec::new());
    }
    raw.split('.')
        .map(|part| {
            if part.is_empty() {
                return Err(CliError::validation("jq path contains an empty segment"));
            }
            if let Some(name) = part.strip_suffix("[]") {
                if name.is_empty() {
                    return Err(CliError::validation("jq [] requires a field name"));
                }
                Ok(Segment {
                    name: name.to_string(),
                    kind: SegmentKind::ArrayItems,
                })
            } else {
                Ok(Segment {
                    name: part.to_string(),
                    kind: SegmentKind::Field,
                })
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::apply;

    #[test]
    fn reads_nested_value() {
        let value = json!({ "data": { "summary": { "total": 2 } } });
        assert_eq!(apply(&value, ".data.summary.total").unwrap(), json!(2));
    }

    #[test]
    fn expands_array_items() {
        let value = json!({ "data": { "rows": [{ "id": 1 }, { "id": 2 }] } });
        assert_eq!(
            apply(&value, ".data.rows[]").unwrap(),
            json!([{ "id": 1 }, { "id": 2 }])
        );
    }
}
