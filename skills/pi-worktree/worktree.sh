#!/bin/bash
#
# pi-worktree: Manage git worktrees for parallel pi/agent sessions
#
# Usage:
#   worktree.sh new <branch> [--base <branch>]          Create worktree from current repo
#   worktree.sh create <repo> <branch> [--base <branch>] Create worktree for specific repo
#   worktree.sh list [repo]                              List worktrees
#   worktree.sh remove [repo] <branch-or-path>           Remove a worktree
#   worktree.sh clean [repo]                             Remove stale/merged worktrees
#

set -euo pipefail

SCRIPT_NAME=$(basename "$0")

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

usage() {
	cat <<EOF
Usage: $SCRIPT_NAME <command> [options]

Commands:
  new <branch> [--base <branch>]               Create worktree from current directory repo
  create <repo-path> <branch> [--base <branch>] Create worktree for specific repo
  list [repo-path]                               List all worktrees
  remove [--branch] [--force] [repo-path] <branch-or-path>  Remove a worktree
  clean [repo-path]                              Remove stale/merged worktrees

Examples:
  $SCRIPT_NAME new feature/payments
  $SCRIPT_NAME new feature/payments --base develop
  $SCRIPT_NAME create ~/code/myproj hotfix/login --base main
  $SCRIPT_NAME list
  $SCRIPT_NAME remove --branch feature/payments
  $SCRIPT_NAME remove --force --branch feature/payments
  $SCRIPT_NAME clean
EOF
	exit 1
}

error() {
	echo -e "${RED}Error: $1${NC}" >&2
	exit 1
}

info() {
	echo -e "${BLUE}$1${NC}" >&2
}

warn() {
	echo -e "${YELLOW}Warning: $1${NC}" >&2
}

success() {
	echo -e "${GREEN}$1${NC}"
}

# Find the git directory for a repo path (or current dir)
find_git_dir() {
	local repo="${1:-.}"
	if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
		error "'$repo' is not a git repository"
	fi
	git -C "$repo" rev-parse --git-dir
}

# Get the real path to the repo root
get_repo_root() {
	local repo="${1:-.}"
	git -C "$repo" rev-parse --show-toplevel
}

# Get the default branch (main or master)
get_default_branch() {
	local repo="${1:-.}"
	if git -C "$repo" show-ref --verify --quiet refs/heads/main; then
		echo "main"
	elif git -C "$repo" show-ref --verify --quiet refs/heads/master; then
		echo "master"
	else
		# Try to find origin/HEAD
		local default
		default=$(git -C "$repo" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||' || true)
		if [[ -n "$default" ]]; then
			echo "$default"
		else
			echo "main"
		fi
	fi
}

# Convert branch name to directory name (replace / with -)
branch_to_dir() {
	echo "$1" | sed 's|/|-|g'
}

# Get the worktree directory for a repo
get_worktrees_dir() {
	local repo_root="$1"
	local parent_dir
	parent_dir=$(dirname "$repo_root")
	local repo_name
	repo_name=$(basename "$repo_root")
	echo "$parent_dir/${repo_name}-worktrees"
}

# Fetch the base branch from origin if needed
ensure_branch_fetched() {
	local repo="$1"
	local base_branch="$2"

	# If it's a remote tracking branch, fetch it
	if git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/$base_branch" 2>/dev/null; then
		if ! git -C "$repo" show-ref --verify --quiet "refs/heads/$base_branch" 2>/dev/null; then
			info "Creating local tracking branch for origin/$base_branch..."
			git -C "$repo" branch --track "$base_branch" "origin/$base_branch" 2>/dev/null ||
				git -C "$repo" branch "$base_branch" "origin/$base_branch"
		fi
	fi
}

# Parse arguments: extracts --base BASE if present
# Sets BASE_BRANCH variable
parse_base_arg() {
	BASE_BRANCH=""
	local -n remaining_args="$1"
	local new_args=()
	local i=0
	while [[ $i -lt ${#remaining_args[@]} ]]; do
		if [[ "${remaining_args[$i]}" == "--base" ]]; then
			i=$((i + 1))
			if [[ $i -ge ${#remaining_args[@]} ]]; then
				error "--base requires a branch name"
			fi
			BASE_BRANCH="${remaining_args[$i]}"
			i=$((i + 1))
		else
			new_args+=("${remaining_args[$i]}")
			i=$((i + 1))
		fi
	done
	remaining_args=("${new_args[@]}")
}

# ═══════════════════════════════════════════════════════════════
# COMMAND: new
# ═══════════════════════════════════════════════════════════════
cmd_new() {
	local args=("$@")
	parse_base_arg args

	if [[ ${#args[@]} -lt 1 ]]; then
		error "new requires a branch name"
	fi

	local branch="${args[0]}"
	local repo_root
	repo_root=$(get_repo_root)

	local base_branch="${BASE_BRANCH:-$(get_default_branch)}"

	cmd_create "$repo_root" "$branch" --base "$base_branch"
}

# ═══════════════════════════════════════════════════════════════
# COMMAND: create
# ═══════════════════════════════════════════════════════════════
cmd_create() {
	local args=("$@")
	parse_base_arg args

	if [[ ${#args[@]} -lt 2 ]]; then
		error "create requires: <repo-path> <branch-name>"
	fi

	local repo_path="${args[0]}"
	local branch="${args[1]}"

	# Resolve to absolute path
	repo_path=$(cd "$repo_path" && pwd)

	local repo_root
	repo_root=$(get_repo_root "$repo_path")

	local base_branch="${BASE_BRANCH:-$(get_default_branch "$repo_path")}"

	# Ensure base branch exists locally
	ensure_branch_fetched "$repo_path" "$base_branch"

	if ! git -C "$repo_path" show-ref --verify --quiet "refs/heads/$base_branch"; then
		error "Base branch '$base_branch' does not exist locally. Run 'git fetch origin' first?"
	fi

	# Determine worktree path
	local worktrees_dir
	worktrees_dir=$(get_worktrees_dir "$repo_root")

	local dir_name
	dir_name=$(branch_to_dir "$branch")
	local worktree_path="$worktrees_dir/$dir_name"

	# Check if branch already exists in another worktree
	local existing_worktree
	existing_worktree=$(git -C "$repo_path" worktree list --porcelain 2>/dev/null |
		grep -A1 "^branch refs/heads/$branch$" | head -2 | grep "^worktree " | cut -d' ' -f2- || true)

	if [[ -n "$existing_worktree" ]]; then
		error "Branch '$branch' is already checked out at: $existing_worktree"
	fi

	# Check if worktree directory already exists
	if [[ -d "$worktree_path" ]]; then
		error "Worktree directory already exists: $worktree_path"
	fi

	# Ensure parent directory exists
	mkdir -p "$worktrees_dir"

	info "Creating worktree for branch '$branch' from '$base_branch'..."

	# Create the branch and worktree
	git -C "$repo_path" worktree add -b "$branch" "$worktree_path" "$base_branch"

	success "✅ Worktree created"
	echo ""
	echo -e "${CYAN}Worktree:${NC}  $worktree_path"
	echo -e "${CYAN}Branch:${NC}    $branch (from $base_branch)"
	echo ""
	echo -e "${BOLD}Start a pi session there:${NC}"
	echo -e "  cd $worktree_path && pi \"...\""
}

# ═══════════════════════════════════════════════════════════════
# COMMAND: list
# ═══════════════════════════════════════════════════════════════
cmd_list() {
	local repo_path="${1:-.}"

	# If . is not a repo, require explicit path
	if [[ "$repo_path" == "." ]]; then
		if ! git rev-parse --git-dir >/dev/null 2>&1; then
			error "Not in a git repository. Provide a repo path: list <repo-path>"
		fi
	fi

	repo_path=$(cd "$repo_path" && pwd)

	local repo_root
	repo_root=$(get_repo_root "$repo_path")

	echo -e "${BOLD}Worktrees for:${NC} $repo_root"
	echo ""

	local output
	output=$(git -C "$repo_path" worktree list --porcelain 2>/dev/null || true)

	if [[ -z "$output" ]]; then
		echo "No worktrees found"
		return 0
	fi

	# Parse worktree list
	local current_worktree=""
	local current_branch=""
	local current_detached=""
	local current_locked=""
	local first=1

	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ "$line" == "worktree "* ]]; then
			# Print previous worktree info
			if [[ "$first" != "1" && -n "$current_worktree" ]]; then
				print_worktree_info "$current_worktree" "$current_branch" "$current_detached" "$current_locked"
			fi
			current_worktree="${line#worktree }"
			current_branch=""
			current_detached=""
			current_locked=""
			first=0
		elif [[ "$line" == "branch refs/heads/"* ]]; then
			current_branch="${line#branch refs/heads/}"
		elif [[ "$line" == "detached" ]]; then
			current_detached="yes"
		elif [[ "$line" == "locked" ]]; then
			current_locked="yes"
		elif [[ -z "$line" ]]; then
			# End of entry
			if [[ "$first" != "1" && -n "$current_worktree" ]]; then
				print_worktree_info "$current_worktree" "$current_branch" "$current_detached" "$current_locked"
				current_worktree=""
				first=1
			fi
		fi
	done <<<"$output"

	# Print last entry
	if [[ "$first" != "1" && -n "$current_worktree" ]]; then
		print_worktree_info "$current_worktree" "$current_branch" "$current_detached" "$current_locked"
	fi
}

print_worktree_info() {
	local worktree_path="$1"
	local branch="${2:-}"
	local detached="${3:-}"
	local locked="${4:-}"

	local repo_root
	repo_root=$(get_repo_root "$worktree_path" 2>/dev/null || echo "")

	local is_main_worktree=""
	if [[ "$worktree_path" == "$repo_root" ]]; then
		is_main_worktree=" ${YELLOW}[main]${NC}"
	fi

	local branch_display=""
	if [[ -n "$branch" ]]; then
		branch_display=" ${CYAN}($branch)${NC}"
	elif [[ "$detached" == "yes" ]]; then
		branch_display=" ${CYAN}(detached)${NC}"
	fi

	local locked_display=""
	if [[ "$locked" == "yes" ]]; then
		locked_display=" ${YELLOW}[locked]${NC}"
	fi

	local prunable=""
	if [[ "$is_main_worktree" == "" && ! -d "$worktree_path" ]]; then
		prunable=" ${RED}[stale/missing]${NC}"
	fi

	echo -e "  ${worktree_path}${branch_display}${is_main_worktree}${locked_display}${prunable}"
}

# ═══════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════
# COMMAND: remove
# ═══════════════════════════════════════════════════════════════
cmd_remove() {
	local args=("$@")
	local delete_branch=false
	local force=false

	# Parse flags
	local remaining=()
	for arg in "${args[@]}"; do
		if [[ "$arg" == "--branch" ]]; then
			delete_branch=true
		elif [[ "$arg" == "--force" ]]; then
			force=true
		else
			remaining+=("$arg")
		fi
	done

	if [[ ${#remaining[@]} -lt 1 ]]; then
		error "remove requires a branch name or worktree path"
	fi

	local target=""
	local repo_path="."

	if [[ ${#remaining[@]} -eq 1 ]]; then
		target="${remaining[0]}"
	elif [[ ${#remaining[@]} -ge 2 ]]; then
		if git -C "${remaining[0]}" rev-parse --git-dir >/dev/null 2>&1; then
			repo_path="${remaining[0]}"
			target="${remaining[-1]}"
		else
			target="${remaining[-1]}"
		fi
	fi

	repo_path=$(cd "$repo_path" && pwd)

	# Resolve worktree path
	local worktree_path=""
	if [[ "$target" == /* && -d "$target" ]]; then
		worktree_path="$target"
	elif [[ -d "$target" ]]; then
		worktree_path=$(cd "$target" && pwd)
	else
		local dir_name
		dir_name=$(branch_to_dir "$target")
		local repo_root
		repo_root=$(get_repo_root "$repo_path")
		local worktrees_dir
		worktrees_dir=$(get_worktrees_dir "$repo_root")
		if [[ -d "$worktrees_dir/$dir_name" ]]; then
			worktree_path="$worktrees_dir/$dir_name"
		fi
	fi

	if [[ -z "$worktree_path" ]]; then
		error "Could not find worktree for '$target'. Use 'list' to see worktrees."
	fi
	if [[ ! -d "$worktree_path" ]]; then
		error "Worktree path does not exist: $worktree_path"
	fi

	# Determine branch from worktree before removing
	local branch_name=""
	branch_name=$(git -C "$repo_path" worktree list --porcelain 2>/dev/null |
		awk -v wt="$worktree_path" 'BEGIN{RS=""; FS="\n"} $1 == "worktree " wt {for(i=2;i<=NF;i++) if ($i ~ /^branch refs\/heads\//) {print substr($i, 19); exit}}')

	if [[ "$force" != true ]]; then
		warn "This will remove worktree: $worktree_path"
		if [[ "$delete_branch" == true && -n "$branch_name" ]]; then
			warn "The branch '$branch_name' will also be deleted"
		fi
		read -p "Proceed? [y/N] " -n 1 -r
		echo ""
		if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
			info "Aborted."
			return 0
		fi
	fi

	info "Removing worktree: $worktree_path"
	git -C "$repo_path" worktree remove "$worktree_path" 2>/dev/null ||
		git -C "$repo_path" worktree remove --force "$worktree_path"

	# Clean up empty parent dirs
	local parent
	parent=$(dirname "$worktree_path")
	if [[ -d "$parent" && -z "$(ls -A "$parent" 2>/dev/null || true)" ]]; then
		rmdir "$parent" 2>/dev/null || true
	fi

	success "✅ Worktree removed: $worktree_path"

	# Optionally delete the branch
	if [[ "$delete_branch" == true && -n "$branch_name" ]]; then
		local main_branch
		main_branch=$(get_default_branch "$repo_path")

		if git -C "$repo_path" show-ref --verify --quiet "refs/heads/$branch_name"; then
			local is_merged=false
			if git -C "$repo_path" merge-base --is-ancestor "$branch_name" "$main_branch" 2>/dev/null; then
				is_merged=true
			fi

			if [[ "$is_merged" == true ]]; then
				info "Deleting merged branch: $branch_name"
				git -C "$repo_path" branch -d "$branch_name"
				success "✅ Branch deleted: $branch_name"
			else
				warn "Branch '$branch_name' is NOT merged into $main_branch"
				if [[ "$force" != true ]]; then
					read -p "Force delete unmerged branch? [y/N] " -n 1 -r
					echo ""
					if [[ "$REPLY" =~ ^[Yy]$ ]]; then
						git -C "$repo_path" branch -D "$branch_name"
						success "✅ Branch force-deleted: $branch_name"
					else
						info "Branch '$branch_name' was kept."
					fi
				else
					git -C "$repo_path" branch -D "$branch_name"
					success "✅ Branch force-deleted: $branch_name"
				fi
			fi
		fi
	fi
}

# ═══════════════════════════════════════════════════════════════
# COMMAND: clean
# ═══════════════════════════════════════════════════════════════
cmd_clean() {
	local repo_path="${1:-.}"

	if [[ "$repo_path" == "." ]]; then
		if ! git rev-parse --git-dir >/dev/null 2>&1; then
			error "Not in a git repository. Provide a repo path: clean <repo-path>"
		fi
	fi

	repo_path=$(cd "$repo_path" && pwd)
	local repo_root
	repo_root=$(get_repo_root "$repo_path")
	local main_branch
	main_branch=$(get_default_branch "$repo_path")

	info "Scanning for stale or merged worktrees (base: $main_branch)..."

	# Get list of worktrees
	local output
	output=$(git -C "$repo_path" worktree list --porcelain 2>/dev/null || true)

	local to_remove=()
	local current_worktree=""
	local current_branch=""
	local current_detached=""

	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ "$line" == "worktree "* ]]; then
			current_worktree="${line#worktree }"
			current_branch=""
			current_detached=""
		elif [[ "$line" == "branch refs/heads/"* ]]; then
			current_branch="${line#branch refs/heads/}"
		elif [[ "$line" == "detached" ]]; then
			current_detached="yes"
		elif [[ -z "$line" && -n "$current_worktree" ]]; then
			# Skip main worktree
			if [[ "$current_worktree" == "$repo_root" ]]; then
				current_worktree=""
				continue
			fi

			local reason=""

			# Check if directory is missing
			if [[ ! -d "$current_worktree" ]]; then
				reason="directory missing"
			# Check if branch no longer exists
			elif [[ -n "$current_branch" && ! "$current_branch" =~ ^(main|master)$ ]]; then
				if ! git -C "$repo_path" show-ref --verify --quiet "refs/heads/$current_branch" 2>/dev/null; then
					reason="branch '$current_branch' does not exist"
				# Check if branch is merged into main
				elif git -C "$repo_path" merge-base --is-ancestor "$current_branch" "$main_branch" 2>/dev/null; then
					reason="branch '$current_branch' is merged into $main_branch"
				fi
			fi

			if [[ -n "$reason" ]]; then
				to_remove+=("$current_worktree|$reason")
			fi

			current_worktree=""
		fi
	done <<<"$output"

	if [[ ${#to_remove[@]} -eq 0 ]]; then
		success "No stale worktrees found."
		return 0
	fi

	echo ""
	echo -e "${YELLOW}The following worktrees can be removed:${NC}"
	for item in "${to_remove[@]}"; do
		IFS='|' read -r wt reason <<<"$item"
		echo "  • $wt"
		echo "    ($reason)"
	done

	echo ""
	read -p "Remove all? [y/N] " -n 1 -r
	echo ""
	if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
		info "Aborted."
		return 0
	fi

	for item in "${to_remove[@]}"; do
		IFS='|' read -r wt reason <<<"$item"
		info "Removing: $wt"
		git -C "$repo_path" worktree remove "$wt" 2>/dev/null ||
			git -C "$repo_path" worktree remove --force "$wt" 2>/dev/null ||
			warn "Failed to remove $wt (may need manual cleanup)"
	done

	# Clean up empty worktrees dir
	local worktrees_dir
	worktrees_dir=$(get_worktrees_dir "$repo_root")
	if [[ -d "$worktrees_dir" && -z "$(ls -A "$worktrees_dir" 2>/dev/null || true)" ]]; then
		rmdir "$worktrees_dir" 2>/dev/null || true
	fi

	success "✅ Cleanup complete."
}

# ═══════════════════════════════════════════════════════════════
# Main dispatch
# ═══════════════════════════════════════════════════════════════

if [[ $# -lt 1 ]]; then
	usage
fi

COMMAND="$1"
shift

case "$COMMAND" in
new)
	cmd_new "$@"
	;;
create)
	cmd_create "$@"
	;;
list)
	cmd_list "$@"
	;;
remove)
	cmd_remove "$@"
	;;
clean)
	cmd_clean "$@"
	;;
help | --help | -h)
	usage
	;;
*)
	error "Unknown command: $COMMAND"
	;;
esac
