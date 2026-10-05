/** Rust helpers for the documented, homogeneous JavaScript subset. */
export const RUST_RUNTIME = String.raw`
#[allow(dead_code)]
pub(crate) mod __js2rust {
    #[derive(Clone, Debug, PartialEq)]
    pub enum Maybe<T> { Value(T), Null, Undefined }
    impl<T> Maybe<T> {
        pub fn from_option(value: Option<T>) -> Self { value.map(Self::Value).unwrap_or(Self::Undefined) }
        pub fn is_missing(&self) -> bool { !matches!(self, Self::Value(_)) }
        pub fn is_null(&self) -> bool { matches!(self, Self::Null) }
        pub fn is_undefined(&self) -> bool { matches!(self, Self::Undefined) }
        pub fn value(&self) -> &T { match self { Self::Value(v) => v, _ => panic!("js2rust: missing value") } }
    }
    impl<T> Maybe<Maybe<T>> {
        pub fn flatten(self) -> Maybe<T> { match self { Self::Value(value) => value, Self::Null => Maybe::Null, Self::Undefined => Maybe::Undefined } }
    }
    impl<T: std::fmt::Display> std::fmt::Display for Maybe<T> {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self { Self::Value(v) => write!(f, "{}", v), Self::Null => write!(f, "null"), Self::Undefined => write!(f, "undefined") }
        }
    }
    pub trait Truthy { fn truthy(&self) -> bool; }
    impl Truthy for bool { fn truthy(&self) -> bool { *self } }
    impl Truthy for i64 { fn truthy(&self) -> bool { *self != 0 } }
    impl Truthy for f64 { fn truthy(&self) -> bool { *self != 0.0 && !self.is_nan() } }
    impl Truthy for String { fn truthy(&self) -> bool { !self.is_empty() } }
    impl Truthy for &str { fn truthy(&self) -> bool { !self.is_empty() } }
    impl<T> Truthy for Vec<T> { fn truthy(&self) -> bool { true } }
    impl<T: Truthy> Truthy for Maybe<T> { fn truthy(&self) -> bool { match self { Self::Value(v) => v.truthy(), _ => false } } }
    pub fn truthy<T: Truthy>(value: &T) -> bool { value.truthy() }

    // JavaScript's default sort compares strings by UTF-16 code units.
    pub fn number_text(value: f64) -> String {
        if value.is_nan() { return "NaN".into(); }
        if value == f64::INFINITY { return "Infinity".into(); }
        if value == f64::NEG_INFINITY { return "-Infinity".into(); }
        if value == 0.0 { return "0".into(); }
        let text = value.to_string();
        let absolute = value.abs();
        if absolute >= 1e21 || absolute < 1e-6 {
            let negative = text.starts_with('-');
            let raw = text.trim_start_matches('-');
            let point = raw.find('.').unwrap_or(raw.len());
            let digits: String = raw.chars().filter(|c| *c != '.').collect();
            let start = digits.find(|c| c != '0').unwrap_or(0);
            let exponent = point as i32 - start as i32 - 1;
            let significant = digits[start..].trim_end_matches('0');
            let tail = if significant.len() > 1 { format!(".{}", &significant[1..]) } else { String::new() };
            return format!("{}{}{}e{}{}", if negative { "-" } else { "" }, &significant[..1], tail, if exponent >= 0 { "+" } else { "" }, exponent);
        }
        text
    }
    pub trait SortText { fn sort_text(&self) -> String; }
    impl SortText for String { fn sort_text(&self) -> String { self.clone() } }
    impl SortText for bool { fn sort_text(&self) -> String { self.to_string() } }
    impl SortText for i64 { fn sort_text(&self) -> String { self.to_string() } }
    impl SortText for f64 { fn sort_text(&self) -> String { number_text(*self) } }
    pub fn sort_default<T: SortText>(values: &mut [T]) {
        values.sort_by(|a, b| a.sort_text().encode_utf16().cmp(b.sort_text().encode_utf16()));
    }
    pub fn utf16_cmp(a: &str, b: &str) -> std::cmp::Ordering { a.encode_utf16().cmp(b.encode_utf16()) }

    #[derive(Clone, Debug)]
    pub struct Map<K, V> { entries: Vec<(K, V)> }
    impl<K: SameValueZero + Clone, V: Clone> Map<K, V> {
        pub fn new(entries: Vec<(K, V)>) -> Self { let mut map = Self { entries: Vec::new() }; for (k, v) in entries { map.set(k, v); } map }
        pub fn set(&mut self, key: K, value: V) -> &mut Self {
            let key = key.canonical();
            if let Some((_, old)) = self.entries.iter_mut().find(|(k, _)| k.same(&key)) { *old = value; }
            else { self.entries.push((key, value)); } self
        }
        pub fn get(&self, key: &K) -> Maybe<V> { Maybe::from_option(self.entries.iter().find(|(k, _)| k.same(key)).map(|(_, v)| v.clone())) }
        pub fn has(&self, key: &K) -> bool { self.entries.iter().any(|(k, _)| k.same(key)) }
        pub fn delete(&mut self, key: &K) -> bool { if let Some(i) = self.entries.iter().position(|(k, _)| k.same(key)) { self.entries.remove(i); true } else { false } }
        pub fn clear(&mut self) { self.entries.clear(); }
        pub fn size(&self) -> i64 { self.entries.len() as i64 }
        pub fn keys(&self) -> Vec<K> { self.entries.iter().map(|(k, _)| k.clone()).collect() }
        pub fn values(&self) -> Vec<V> { self.entries.iter().map(|(_, v)| v.clone()).collect() }
    }
    #[derive(Clone, Debug)]
    pub struct Set<T> { values: Vec<T> }
    impl<T: SameValueZero + Clone> Set<T> {
        pub fn new(values: Vec<T>) -> Self { let mut set = Self { values: Vec::new() }; for value in values { set.add(value); } set }
        pub fn add(&mut self, value: T) -> &mut Self { let value = value.canonical(); if !self.has(&value) { self.values.push(value); } self }
        pub fn has(&self, value: &T) -> bool { self.values.iter().any(|v| v.same(value)) }
        pub fn delete(&mut self, value: &T) -> bool { if let Some(i) = self.values.iter().position(|v| v.same(value)) { self.values.remove(i); true } else { false } }
        pub fn clear(&mut self) { self.values.clear(); }
        pub fn size(&self) -> i64 { self.values.len() as i64 }
        pub fn values(&self) -> Vec<T> { self.values.clone() }
        pub fn keys(&self) -> Vec<T> { self.values.clone() }
    }

    // Tagged JSON preserves undefined, NaN and infinities in comparison results.
    pub trait JsonValue { fn json(&self) -> String; }
    impl JsonValue for () { fn json(&self) -> String { "{\"$js2rust\":\"undefined\"}".into() } }
    impl JsonValue for bool { fn json(&self) -> String { self.to_string() } }
    impl JsonValue for i64 { fn json(&self) -> String { self.to_string() } }
    impl JsonValue for f64 { fn json(&self) -> String {
        if *self == 0.0 && self.is_sign_negative() { return "{\"$js2rust\":\"-0\"}".into(); }
        if self.is_finite() { self.to_string() } else { format!("{{\"$js2rust\":\"{}\"}}", number_text(*self)) }
    } }
    impl JsonValue for str { fn json(&self) -> String {
        let mut out = String::from("\"");
        for c in self.chars() { match c { '"' => out.push_str("\\\""), '\\' => out.push_str("\\\\"), '\n' => out.push_str("\\n"), '\r' => out.push_str("\\r"), '\t' => out.push_str("\\t"), c if (c as u32) < 32 => out.push_str(&format!("\\u{:04x}", c as u32)), c => out.push(c) } }
        out.push('"'); out
    } }
    impl JsonValue for &str { fn json(&self) -> String { (**self).json() } }
    impl JsonValue for String { fn json(&self) -> String { self.as_str().json() } }
    impl<T: JsonValue> JsonValue for Vec<T> { fn json(&self) -> String { format!("[{}]", self.iter().map(JsonValue::json).collect::<Vec<_>>().join(",")) } }
    impl<T: JsonValue> JsonValue for Maybe<T> { fn json(&self) -> String { match self { Self::Value(v) => v.json(), Self::Null => "null".into(), Self::Undefined => ().json() } } }
    impl<K: JsonValue, V: JsonValue> JsonValue for Map<K, V> { fn json(&self) -> String { format!("{{\"$js2rust\":\"Map\",\"entries\":[{}]}}", self.entries.iter().map(|(k,v)| format!("[{},{}]", k.json(),v.json())).collect::<Vec<_>>().join(",")) } }
    impl<T: JsonValue> JsonValue for Set<T> { fn json(&self) -> String { format!("{{\"$js2rust\":\"Set\",\"values\":{}}}", self.values.json()) } }
    pub fn json<T: JsonValue + ?Sized>(value: &T) -> String { value.json() }
    pub fn index(value: f64, len: usize) -> usize {
        let value = if value.is_nan() { 0.0 } else { value.trunc() };
        if value < 0.0 { (len as f64 + value).max(0.0) as usize }
        else { value.min(len as f64) as usize }
    }

    pub fn slice<T: Clone>(values: &[T], start: f64, end: Option<f64>) -> Vec<T> {
        let start = index(start, values.len());
        let end = end.map(|v| index(v, values.len())).unwrap_or(values.len());
        values[start..end.max(start)].to_vec()
    }

    pub fn splice<T>(values: &mut Vec<T>, start: f64, delete: Option<f64>, items: Vec<T>) -> Vec<T> {
        let start = index(start, values.len());
        let count = delete.map(|v| if v.is_nan() { 0 } else { v.trunc().max(0.0) as usize })
            .unwrap_or(values.len() - start).min(values.len() - start);
        values.splice(start..start + count, items).collect()
    }

    pub fn split(text: &str, separator: Option<&str>, limit: Option<f64>) -> Vec<String> {
        let limit = limit.map(|v| {
            if !v.is_finite() { 0usize } else { v.trunc().rem_euclid(4294967296.0) as usize }
        }).unwrap_or(u32::MAX as usize);
        if limit == 0 { return Vec::new(); }
        match separator {
            None => vec![text.to_string()],
            Some("") => {
                // Rust String cannot represent lone UTF-16 surrogates. Fail explicitly.
                assert!(!text.chars().any(|c| c as u32 > 0xffff),
                    "js2rust: split with an empty separator on non-BMP text is unsupported");
                text.chars().take(limit).map(|c| c.to_string()).collect()
            }
            Some(separator) => text.split(separator).take(limit).map(str::to_string).collect(),
        }
    }

    pub fn join<T: SortText>(values: &[T], separator: &str) -> String {
        values.iter().map(SortText::sort_text).collect::<Vec<_>>().join(separator)
    }

    pub trait SameValueZero { fn same(&self, other: &Self) -> bool; fn canonical(self) -> Self where Self: Sized { self } }
    impl SameValueZero for i64 { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for i32 { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for usize { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for bool { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for String { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for f64 {
        fn same(&self, other: &Self) -> bool { self == other || (self.is_nan() && other.is_nan()) }
        fn canonical(self) -> Self { if self == 0.0 { 0.0 } else { self } }
    }
    pub fn includes<T: SameValueZero>(values: &[T], value: &T, start: f64) -> bool {
        values[index(start, values.len())..].iter().any(|v| v.same(value))
    }
    pub fn index_of<T: PartialEq>(values: &[T], value: &T, start: f64) -> i64 {
        let start = index(start, values.len());
        values[start..].iter().position(|v| v == value).map(|i| (i + start) as i64).unwrap_or(-1)
    }
}
`;
