use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct State {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct StateListResponse {
    pub results: Vec<State>,
}

#[derive(Serialize)]
pub struct CreateStatePayload<'a> {
    pub name: &'a str,
    pub color: &'a str,
}
