use super::{unsupported, Ctx, Res};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    CherryPick,
    Revert,
}

pub fn run(_ctx: &Ctx, _kind: Kind, args: &[String]) -> Res {
    Ok(unsupported(args))
}
