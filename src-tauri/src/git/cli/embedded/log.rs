//! `git log ...` (`--follow`): not served by the embedded shim yet (R1b-2
//! replaces this body).

use super::{unsupported, Ctx, Res};

pub fn run(_ctx: &Ctx, args: &[String]) -> Res {
    let mut full = vec!["log".to_string()];
    full.extend(args.iter().cloned());
    Ok(unsupported(&full))
}
