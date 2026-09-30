use super::{unsupported, Ctx, Res};

pub fn run(_ctx: &Ctx, args: &[String]) -> Res {
    let mut full = vec!["merge".to_string()];
    full.extend(args.iter().cloned());
    Ok(unsupported(&full))
}
