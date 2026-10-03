/** Rust helpers for the documented, homogeneous JavaScript subset. */
export const RUST_RUNTIME = String.raw`
#[allow(dead_code)]
mod __js2rust {
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

    pub fn join<T: std::fmt::Display>(values: &[T], separator: &str) -> String {
        values.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(separator)
    }

    pub trait SameValueZero { fn same(&self, other: &Self) -> bool; }
    impl SameValueZero for i64 { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for i32 { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for usize { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for bool { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for String { fn same(&self, other: &Self) -> bool { self == other } }
    impl SameValueZero for f64 {
        fn same(&self, other: &Self) -> bool { self == other || (self.is_nan() && other.is_nan()) }
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
