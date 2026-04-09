use uuid::Uuid;

use crate::db::models::User;

/// Represents the authenticated user context for ACL decisions.
#[derive(Debug, Clone)]
pub struct UserContext {
    pub user_id: Uuid,
    pub email: String,
    pub is_admin: bool,
}

impl From<&User> for UserContext {
    fn from(user: &User) -> Self {
        Self {
            user_id: user.id,
            email: user.email.clone(),
            is_admin: user.is_admin,
        }
    }
}

impl From<User> for UserContext {
    fn from(user: User) -> Self {
        Self {
            user_id: user.id,
            email: user.email,
            is_admin: user.is_admin,
        }
    }
}
