use serde_json::Value;

const SUPPORTED_TYPES: &[&str] = &[
    "array", "boolean", "integer", "null", "number", "object", "string",
];

pub fn validate(schema: &Value, value: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    validate_at("$", schema, value, &mut errors);
    errors
}

pub fn validate_schema_definition(schema: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    validate_schema_at("$", schema, &mut errors);
    errors
}

fn validate_at(path: &str, schema: &Value, value: &Value, errors: &mut Vec<String>) {
    if type_allows_null(schema) && value.is_null() {
        return;
    }
    if let Some(expected) = schema.get("type") {
        let error_count = errors.len();
        validate_type(path, expected, value, errors);
        if errors.len() > error_count {
            return;
        }
    }
    if value.is_object() {
        validate_object(path, schema, value, errors);
    }
    if value.is_array() {
        validate_array(path, schema, value, errors);
    }
    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64) {
        if let Some(number) = value.as_f64() {
            if number < minimum {
                errors.push(format!("{path} must be >= {minimum}"));
            }
        }
    }
    if let Some(min_length) = schema.get("minLength").and_then(Value::as_u64) {
        if let Some(text) = value.as_str() {
            if text.chars().count() < min_length as usize {
                errors.push(format!("{path} length must be >= {min_length}"));
            }
        }
    }
}

fn validate_schema_at(path: &str, schema: &Value, errors: &mut Vec<String>) {
    let Some(object) = schema.as_object() else {
        errors.push(format!("{path} schema must be an object"));
        return;
    };
    if let Some(expected) = object.get("type") {
        for type_name in schema_type_names(expected) {
            if !is_supported_type(type_name) {
                errors.push(format!("{path}.type `{type_name}` is not supported"));
            }
        }
    }
    if let Some(required) = object.get("required") {
        match required.as_array() {
            Some(items) if items.iter().all(Value::is_string) => {}
            _ => errors.push(format!("{path}.required must be an array of strings")),
        }
    }
    if let Some(properties) = object.get("properties") {
        match properties.as_object() {
            Some(items) => {
                for (name, child) in items {
                    validate_schema_at(&format!("{path}.properties.{name}"), child, errors);
                }
            }
            None => errors.push(format!("{path}.properties must be an object")),
        }
    }
    if let Some(items) = object.get("items") {
        validate_schema_at(&format!("{path}.items"), items, errors);
    }
}

fn schema_type_names(value: &Value) -> Vec<&str> {
    match value {
        Value::String(name) => vec![name.as_str()],
        Value::Array(items) => items.iter().filter_map(Value::as_str).collect(),
        _ => Vec::new(),
    }
}

fn is_supported_type(name: &str) -> bool {
    SUPPORTED_TYPES.contains(&name)
}

fn validate_object(path: &str, schema: &Value, value: &Value, errors: &mut Vec<String>) {
    let Some(object) = value.as_object() else {
        return;
    };
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        for item in required {
            if let Some(name) = item.as_str() {
                if !object.contains_key(name) {
                    errors.push(format!("{path}.{name} is required"));
                }
            }
        }
    }
    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return;
    };
    for (name, child_schema) in properties {
        if let Some(child_value) = object.get(name) {
            validate_at(&format!("{path}.{name}"), child_schema, child_value, errors);
        }
    }
}

fn validate_array(path: &str, schema: &Value, value: &Value, errors: &mut Vec<String>) {
    let Some(items) = value.as_array() else {
        return;
    };
    if let Some(min_items) = schema.get("minItems").and_then(Value::as_u64) {
        if items.len() < min_items as usize {
            errors.push(format!("{path} item count must be >= {min_items}"));
        }
    }
    let Some(item_schema) = schema.get("items") else {
        return;
    };
    for (index, item) in items.iter().enumerate() {
        validate_at(&format!("{path}[{index}]"), item_schema, item, errors);
    }
}

fn validate_type(path: &str, expected: &Value, value: &Value, errors: &mut Vec<String>) {
    let allowed = match expected {
        Value::String(name) => vec![name.as_str()],
        Value::Array(items) => items.iter().filter_map(Value::as_str).collect::<Vec<_>>(),
        _ => return,
    };
    if allowed.iter().any(|name| type_matches(name, value)) {
        return;
    }
    errors.push(format!("{path} must be {}", allowed.join(" or ")));
}

fn type_allows_null(schema: &Value) -> bool {
    match schema.get("type") {
        Some(Value::String(name)) => name == "null",
        Some(Value::Array(items)) => items.iter().any(|item| item.as_str() == Some("null")),
        _ => false,
    }
}

fn type_matches(name: &str, value: &Value) -> bool {
    match name {
        "array" => value.is_array(),
        "boolean" => value.is_boolean(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "null" => value.is_null(),
        "number" => value.is_number(),
        "object" => value.is_object(),
        "string" => value.is_string(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{validate, validate_schema_definition};

    #[test]
    fn validates_required_and_types() {
        let schema = json!({
            "type": "object",
            "required": ["name", "rows"],
            "properties": {
                "name": { "type": "string", "minLength": 1 },
                "rows": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "required": ["id"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 }
                        }
                    }
                }
            }
        });
        let errors = validate(&schema, &json!({"name": "", "rows": [{"id": 0}]}));

        assert_eq!(
            errors,
            vec!["$.name length must be >= 1", "$.rows[0].id must be >= 1"]
        );
    }

    #[test]
    fn rejects_unsupported_schema_types() {
        let schema = json!({"type": "date"});

        assert_eq!(
            validate_schema_definition(&schema),
            vec!["$.type `date` is not supported"]
        );
        assert_eq!(
            validate(&schema, &json!("2026-05-10")),
            vec!["$ must be date"]
        );
    }
}
