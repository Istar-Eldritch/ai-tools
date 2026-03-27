use crate::cli::RunArgs;
use crate::error::AppResult;

pub fn execute(args: RunArgs) -> AppResult<()> {
    println!(
        "run: would launch claude in sandbox (args: {:?})",
        args.claude_args
    );
    Ok(())
}
