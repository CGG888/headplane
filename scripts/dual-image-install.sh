#!/usr/bin/env bash
# =============================================================================
# dual-image-install.sh
#
# Interactive installer for the two-container deployment of Headscale and
# HeadplaneCN described in docs/install/dual-image.md:
#
#   headscale  -> container "headscale"  (image pinned by --headscale-tag)
#   headplane  -> container "headplane"  (image pinned by --headplane-tag)
#
# The generated stack uses network_mode: host and pid: host.  Every directory is
# asked for (the defaults below are derived from the base directory) and the
# volumes: entries of BOTH services are built from those answers, so both
# containers mount the same host paths at identical container paths:
#
#   <base>/etc/headscale        -> /etc/headscale      (rw in both)
#   <base>/etc/headscale/derp-maps -> /etc/headscale/derp-maps  (rw in both)
#   <base>/data/headscale       -> /var/lib/headscale  (rw in headscale, ro in headplane)
#   <base>/config.yaml          -> /etc/headplane/config.yaml   (ro)
#   <base>/data                 -> /var/lib/headplane  (rw)
#
# Safety rails:
#   * asks for every environment specific value and validates it before use;
#   * asks for every directory, prints the resolved layout before writing and
#     warns instead of silently accepting two prompts pointing at one path;
#   * refuses to run without docker and the "docker compose" plugin
#     (in --dry-run mode only a warning is printed, because nothing changes);
#   * never deletes or moves existing data; existing files are backed up
#     before they are replaced and the originals are always kept;
#   * atomic writes (temp file + mv), chmod 600 on anything holding a secret;
#   * secrets are never echoed back in full (they are masked);
#   * --dry-run prints every file, every copy and every follow-up command and
#     writes nothing outside a private temporary directory;
#   * nothing is started without an explicit confirmation.
#
# Usage:  bash scripts/dual-image-install.sh [options]
#         bash scripts/dual-image-install.sh --help
#
# Human readable prompts and progress go to stderr; the plan, the verification
# output and the final summary go to stdout, so this script can be piped.
# =============================================================================

set -euo pipefail

SCRIPT_NAME="dual-image-install.sh"
SCRIPT_VERSION="1.0.0"

# -----------------------------------------------------------------------------
# Defaults (shown in brackets at each prompt)
# -----------------------------------------------------------------------------
DEFAULT_HS_IMAGE="headscale/headscale:0.29.2"
DEFAULT_HP_IMAGE="ghcr.io/cgg888/headplanecn:0.22.13"
DEFAULT_BASE_DIR="/vol1/1000/APP/headplane"
DEFAULT_SERVER_URL="https://ha.example.com:8443"
DEFAULT_ADMIN_PORT="4100"
DEFAULT_HS_PORT="8080"
DEFAULT_METRICS_PORT="9090"
DEFAULT_STUN_PORT="3478"
DEFAULT_TZ_FALLBACK="Asia/Shanghai"
DEFAULT_DERP_DIR_NAME="derp-maps"
DEFAULT_DERP_MAP_NAME="official-mirror.yaml"
DEFAULT_REGION_ID="999"
DEFAULT_REGION_CODE="headscale"
DEFAULT_REGION_NAME="Headscale Embedded DERP"

# Container paths.  These are fixed by the two images, and they are identical in
# both services on purpose: whatever host path is answered at a prompt is mounted
# at the same container path everywhere, so HeadplaneCN sees exactly the files
# Headscale sees.  Only the host side of the volumes: entries is configurable.
HS_ETC_CTR="/etc/headscale"
HS_DATA_CTR="/var/lib/headscale"
HP_CONFIG_CTR="/etc/headplane/config.yaml"
HP_DATA_CTR="/var/lib/headplane"
HS_CONFIG_CTR="/etc/headscale/config.yaml"

# -----------------------------------------------------------------------------
# State
# -----------------------------------------------------------------------------
DRY_RUN=0
USE_DEFAULTS=0
SELF_TEST=0
HOST_NETWORK=1
OPT_BASE_DIR=""
OPT_HS_IMAGE=""
OPT_HP_IMAGE=""
OPT_SERVER_URL=""
OPT_DERP_HOST=""
OPT_ADMIN_HOST=""
OPT_HP_PORT=""
OPT_ADMIN_BIND=""
OPT_STUN_PORT=""
OPT_TZ=""
OPT_REGION_ID=""

BASE_DIR=""
HS_ETC=""
HS_DATA=""
HP_CONFIG=""
HP_DATA=""
DERP_MAP_DIR=""
DERP_DIR_CTR=""
COMPOSE_FILE=""
BACKUP_DIR=""
LAYOUT_COLLISION=0

HS_IMAGE=""
HP_IMAGE=""
SERVER_URL=""
CLIENT_HOST=""
CLIENT_PORT=""
CLIENT_SCHEME=""
DERP_HOST=""
DERP_URL=""
ADMIN_HOST=""
ADMIN_URL=""
BASE_URL=""
HP_PORT=""
# Where the admin UI ends up reachable from, and what the container binds.
# ADMIN_BIND is the operator's choice (0.0.0.0 or 127.0.0.1); HP_LISTEN_ADDR is
# what server.host is set to: with bridge networking the container must listen on
# 0.0.0.0 for docker to forward the published port, and the exposure is decided by
# the published address instead.
ADMIN_BIND=""
HP_LISTEN_ADDR=""
STUN_PORT=""
METRICS_ADDR=""
TZONE=""
REGION_ID=""
REGION_CODE=""
REGION_NAME=""
DERP_MAP_CTR=""
DERP_MAP_HOST=""
API_KEY=""
API_KEY_STATE=""
COOKIE_SECRET=""
COOKIE_STATE=""
KEEP_COOKIE=0
HS_CONFIG_MODE=""
MIGRATE_SRC=""
MIGRATE_ACTIVE=0
START_NOW=0
ROOT_UID=0
HAVE_OPENSSL=0
HAVE_CURL=0
RUN_TS=""
RUN_STAMP=""

TMP_ROOT=""
STAGE_DIR=""
declare -a TMP_FILES=()
declare -a TMP_DIRS=()
declare -a WRITTEN_FILES=()
declare -a COPIED_FILES=()
declare -a BACKUP_FILES=()
declare -a PLAN_NOTES=()
declare -a CHANGES=()

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
if [[ -t 2 ]]; then
	C_BOLD=$'\033[1m'
	C_DIM=$'\033[2m'
	C_RED=$'\033[31m'
	C_YEL=$'\033[33m'
	C_GRN=$'\033[32m'
	C_OFF=$'\033[0m'
else
	C_BOLD=""
	C_DIM=""
	C_RED=""
	C_YEL=""
	C_GRN=""
	C_OFF=""
fi

say() { printf '%s\n' "$*" >&2; }
head2() { printf '\n%s== %s ==%s\n' "$C_BOLD" "$*" "$C_OFF" >&2; }
info() { printf '%s\n' "$*" >&2; }
dim() { printf '%s%s%s\n' "$C_DIM" "$*" "$C_OFF" >&2; }
ok() { printf '%s%s%s\n' "$C_GRN" "$*" "$C_OFF" >&2; }
warn() { printf '%sWARNING:%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
verr() { printf '  %sinvalid:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
err() { printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; }
die() {
	printf '%sERROR:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2
	exit 1
}
emit() { printf '%s\n' "$*"; }
emit_raw() { printf '%s' "$*"; }

# -----------------------------------------------------------------------------
# Temp files / cleanup.  There is no "rm -rf" anywhere in this script: every
# temporary file is registered and removed by name, then its directory is
# removed with rmdir (which only ever removes an empty directory).
# -----------------------------------------------------------------------------
cleanup() {
	local rc=$?
	trap - EXIT
	local f d i
	if ((${#TMP_FILES[@]} > 0)); then
		for f in "${TMP_FILES[@]}"; do
			[[ -n $f && -e $f ]] && rm -f "$f" 2>/dev/null || true
		done
	fi
	if ((${#TMP_DIRS[@]} > 0)); then
		for ((i = ${#TMP_DIRS[@]} - 1; i >= 0; i--)); do
			d="${TMP_DIRS[$i]}"
			[[ -n $d && -d $d ]] && rmdir "$d" 2>/dev/null || true
		done
	fi
	exit "$rc"
}

new_tmp_file() {
	local d="${1:-$TMP_ROOT}" f
	f="$(mktemp "$d/.dii.XXXXXX")"
	TMP_FILES+=("$f")
	printf '%s' "$f"
}

new_tmp_dir() {
	local d
	d="$(mktemp -d "${TMPDIR:-/tmp}/dual-image-install.XXXXXX")"
	TMP_DIRS+=("$d")
	printf '%s' "$d"
}

# -----------------------------------------------------------------------------
# Small helpers
# -----------------------------------------------------------------------------
trim() {
	local s="$1"
	s="${s#"${s%%[![:space:]]*}"}"
	s="${s%"${s##*[![:space:]]}"}"
	printf '%s' "$s"
}

norm_path() {
	local p="$1"
	while [[ $p == */ && $p != "/" ]]; do
		p="${p%/}"
	done
	printf '%s' "$p"
}

# Deepest ancestor of a path that already exists (used to decide whether the
# installer would be able to create it without touching anything).
path_deepest_existing() {
	local p="$1"
	while [[ ! -e $p && $p != "/" ]]; do
		p="$(dirname "$p")"
	done
	printf '%s' "$p"
}

# Container path of a DERP map directory that lives inside the Headscale config
# directory: the config directory is mounted at the same container path in both
# services, so the sub-directory keeps its relative position.
derp_container_dir() { # <derp dir> <headscale config dir> <config dir in container>
	local dir="$1" etc="$2" ctr="$3" rel
	rel="${dir#"$etc"}"
	printf '%s' "${ctr}${rel}"
}

mask_secret() {
	local v="${1-}"
	local n=${#v}
	if ((n == 0)); then
		printf '(empty)'
	elif ((n <= 8)); then
		printf '********'
	else
		printf '%s...%s (len %d, masked)' "${v:0:4}" "${v: -2}" "$n"
	fi
}

mask_config_lines() {
	sed -E 's/^([[:space:]]*(api_key|cookie_secret|client_secret|info_secret)[[:space:]]*:).*/\1 "<redacted>"/'
}

# The change log is printed on every run, so a key that holds a secret has to be
# masked there as well - the same value is written to the file in full.
is_secret_key() {
	case "$1" in
	*secret* | *api_key* | *password* | *passwd* | *token*) return 0 ;;
	*) return 1 ;;
	esac
}

have() { command -v "$1" >/dev/null 2>&1; }

is_uint() {
	local v="$1"
	[[ $v =~ ^[0-9]+$ ]]
}

# Rejects characters that would break YAML quoting or heredoc interpolation.
# Every free text answer goes through this once, so values can be interpolated
# into generated files safely.
reject_special() {
	local v="$1" what="$2"
	if [[ $v == *$'\n'* || $v == *$'\t'* ]]; then
		verr "$what must not contain tabs or newlines"
		return 1
	fi
	if [[ $v == *'"'* || $v == *'\'* || $v == *'$'* || $v == *'`'* ]]; then
		verr "$what must not contain quotes, backslashes, dollar signs or backticks"
		return 1
	fi
	if [[ $v != "$(trim "$v")" ]]; then
		verr "$what must not start or end with whitespace"
		return 1
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Validators.  Each prints its own reason and returns non-zero on failure.
# -----------------------------------------------------------------------------
v_abs_path() {
	local v="$1"
	[[ -n $v ]] || { verr "path is empty"; return 1; }
	[[ $v == /* ]] || { verr "path must be absolute and start with / (got '$v')"; return 1; }
	[[ $v == *"//"* ]] && { verr "path must not contain //"; return 1; }
	case "/$v/" in
	*/../*) { verr "path must not contain a .. component"; return 1; } ;;
	esac
	[[ $v == "/" ]] && { verr "the filesystem root is not a valid deployment directory"; return 1; }
	reject_special "$v" "path" || return 1
	return 0
}

# A directory the installer has to create or write in.  Nothing is created here:
# only the deepest existing ancestor is probed, so --dry-run stays read-only and
# the directories are created later with the mode each one needs.
v_host_dir() {
	local v="$1" probe
	v_abs_path "$v" || return 1
	if [[ -e $v && ! -d $v ]]; then
		verr "exists and is not a directory: $v"
		return 1
	fi
	probe="$(path_deepest_existing "$v")"
	if [[ ! -w $probe ]]; then
		verr "'$probe' is not writable by $(id -un), so $v cannot be created; choose another path or re-run with sudo"
		return 1
	fi
	return 0
}

# A file the installer has to create or rewrite (its directory is created too).
v_host_file() {
	local v="$1" probe
	v_abs_path "$v" || return 1
	if [[ -d $v ]]; then
		verr "is a directory; this prompt asks for a file path: $v"
		return 1
	fi
	if [[ -e $v ]]; then
		[[ -w $v ]] || { verr "exists but is not writable by $(id -un): $v"; return 1; }
		return 0
	fi
	probe="$(path_deepest_existing "$(dirname "$v")")"
	if [[ ! -w $probe ]]; then
		verr "'$probe' is not writable by $(id -un), so $v cannot be created; choose another path or re-run with sudo"
		return 1
	fi
	return 0
}

# The DERP map directory has to stay inside the Headscale config directory: that
# is the directory both containers mount, so the map file is then visible at the
# same container path in both services without an extra volume entry.
v_derp_dir() {
	local v="$1"
	v_host_dir "$v" || return 1
	case "$v" in
	"$HS_ETC" | "$HS_ETC"/*) return 0 ;;
	*)
		verr "the DERP map directory must be $HS_ETC or a directory inside it (that is the directory both containers mount)"
		return 1
		;;
	esac
}

# Refuses a target of the recursive `chown -R 0:0` below.  A recursive chown
# overwrites ownership that nothing records, so it is only acceptable for a
# directory that exists for this deployment: a system directory, the deployment
# root or the HeadplaneCN data directory would take unrelated files with it.
v_recursive_chown_target() {
	local v="$1" d
	local -a system_dirs=(
		/ /etc /usr /bin /sbin /lib /lib64 /lib32 /boot /var /root /tmp /dev
		/proc /sys /run /home /opt /srv /mnt /media /lost+found
	)
	for d in "${system_dirs[@]}"; do
		if [[ $v == "$d" ]]; then
			verr "'$v' is a system directory; refusing to change its ownership recursively"
			return 1
		fi
	done
	if [[ $v == "$BASE_DIR" ]]; then
		verr "'$v' is the deployment root and also holds the HeadplaneCN files; refusing to change its ownership recursively"
		return 1
	fi
	case "$BASE_DIR" in
	"$v"/*)
		verr "'$v' is a parent of the deployment root ($BASE_DIR), so a recursive chown would also take ownership of unrelated files; pick a dedicated directory"
		return 1
		;;
	esac
	local -a headplane_paths=("$HP_DATA" "$HP_CONFIG")
	for d in "${headplane_paths[@]}"; do
		if [[ -n $d && $v == "$d" ]]; then
			verr "'$v' is a HeadplaneCN path; those are written by the HeadplaneCN container as its own user and must keep their owner"
			return 1
		fi
	done
	return 0
}

# Two prompts pointing at the same place must never pass silently: the containers
# would then share one directory that is read-write in one service and read-only
# in the other.
warn_layout_collisions() {
	local -a lnames=("Headscale config directory" "Headscale data directory" "HeadplaneCN data directory" "DERP map directory")
	local -a lpaths=("$HS_ETC" "$HS_DATA" "$HP_DATA" "$DERP_MAP_DIR")
	local i j
	LAYOUT_COLLISION=0
	for ((i = 0; i < ${#lpaths[@]}; i++)); do
		for ((j = i + 1; j < ${#lpaths[@]}; j++)); do
			[[ ${lpaths[i]} == "${lpaths[j]}" ]] || continue
			LAYOUT_COLLISION=1
			warn "${lnames[i]} and ${lnames[j]} are the same path (${lpaths[i]}): the two containers would share that directory at different mount points"
		done
		if [[ $HP_CONFIG == "${lpaths[i]}" ]]; then
			LAYOUT_COLLISION=1
			warn "the HeadplaneCN config file and ${lnames[i]} are the same path (${lpaths[i]}): a file and a directory cannot share a path"
		fi
	done
	if ((LAYOUT_COLLISION)); then
		warn "point the two prompts at different directories unless that is really what you want (the plan repeats the resolved layout)"
	fi
	return 0
}

v_image_ref() {
	local v="$1" repo tag last
	[[ -n $v ]] || { verr "image reference is empty"; return 1; }
	[[ $v == *:* ]] || { verr "image must be written as repo:tag (no :tag found)"; return 1; }
	last="${v##*/}"
	[[ $last == *:* ]] || { verr "the tag must come after the repository, e.g. ghcr.io/owner/name:1.2.3"; return 1; }
	repo="${v%:*}"
	tag="${v##*:}"
	[[ -n $repo ]] || { verr "repository part is empty"; return 1; }
	[[ -n $tag ]] || { verr "tag part is empty"; return 1; }
	[[ $tag =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] || { verr "tag '$tag' contains invalid characters"; return 1; }
	[[ $tag != "latest" ]] || { verr "do not pin 'latest': the guide requires an explicit version tag"; return 1; }
	[[ $repo =~ ^[A-Za-z0-9]([A-Za-z0-9._/-]*[A-Za-z0-9])?$ ]] || { verr "repository '$repo' contains invalid characters"; return 1; }
	[[ $repo != *".."* ]] || { verr "repository must not contain .."; return 1; }
	reject_special "$v" "image reference" || return 1
	return 0
}

v_port() {
	local v="$1"
	is_uint "$v" || { verr "port must be a number (got '$v')"; return 1; }
	((v >= 1 && v <= 65535)) || { verr "port must be between 1 and 65535 (got $v)"; return 1; }
	return 0
}

v_hostname() {
	local v="$1" l
	local -a labels=()
	[[ -n $v ]] || { verr "hostname is empty"; return 1; }
	reject_special "$v" "hostname" || return 1
	if [[ $v =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
		local IFS='.'
		for l in $v; do
			((10#$l <= 255)) || { verr "'$v' is not a valid IPv4 address"; return 1; }
		done
		return 0
	fi
	[[ $v != *..* ]] || { verr "hostname must not contain an empty label"; return 1; }
	[[ $v != .* && $v != *. ]] || { verr "hostname must not start or end with a dot"; return 1; }
	[[ ${#v} -le 253 ]] || { verr "hostname is longer than 253 characters"; return 1; }
	local IFS='.'
	read -r -a labels <<<"$v"
	for l in "${labels[@]}"; do
		[[ ${#l} -ge 1 && ${#l} -le 63 ]] || { verr "label '$l' must be 1-63 characters"; return 1; }
		[[ $l =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || { verr "label '$l' is not a valid DNS label"; return 1; }
	done
	if ((${#labels[@]} > 1)); then
		l="${labels[${#labels[@]} - 1]}"
		[[ $l =~ ^[A-Za-z]{2,}$ ]] || { verr "top level domain '$l' must be alphabetic"; return 1; }
	fi
	return 0
}

# https://host[:port] - no path, no query.
v_http_url() {
	local v="$1" rest hostport host port
	reject_special "$v" "URL" || return 1
	[[ $v == http://* || $v == https://* ]] || { verr "URL must start with http:// or https://"; return 1; }
	rest="${v#*://}"
	[[ -n $rest ]] || { verr "URL has no host"; return 1; }
	[[ $rest != *"/"* ]] && : || { verr "URL must not contain a path (no trailing / either)"; return 1; }
	[[ $rest != *"?"* && $rest != *"#"* ]] || { verr "URL must not contain a query or fragment"; return 1; }
	hostport="$rest"
	host="$hostport"
	port=""
	if [[ $hostport == *:* ]]; then
		host="${hostport%:*}"
		port="${hostport##*:}"
	fi
	v_hostname "$host" || return 1
	[[ -n $port ]] && { v_port "$port" || return 1; }
	return 0
}

# host[:port] | none | direct
v_host_port_opt() {
	local v="$1" host port
	[[ $v == "none" || $v == "direct" ]] && return 0
	reject_special "$v" "hostname" || return 1
	host="$v"
	port=""
	if [[ $v == *:* ]]; then
		host="${v%:*}"
		port="${v##*:}"
	fi
	v_hostname "$host" || return 1
	[[ -n $port ]] && { v_port "$port" || return 1; }
	return 0
}

v_tz() {
	local v="$1"
	[[ -n $v ]] || { verr "timezone is empty"; return 1; }
	reject_special "$v" "timezone" || return 1
	[[ $v =~ ^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$ ]] || { verr "timezone must look like Area/City (or UTC)"; return 1; }
	if [[ -d /usr/share/zoneinfo ]]; then
		[[ -e "/usr/share/zoneinfo/$v" ]] || { verr "no such zone in /usr/share/zoneinfo: $v"; return 1; }
	fi
	return 0
}

v_secret32() {
	local v="$1"
	[[ -n $v ]] || { verr "secret is empty"; return 1; }
	if ((${#v} != 32)); then
		verr "secret must be exactly 32 characters (got ${#v}); generate one with: openssl rand -base64 24"
		return 1
	fi
	reject_special "$v" "secret" || return 1
	return 0
}

v_nonempty() {
	local v="$1"
	[[ -n $v ]] || { verr "value must not be empty"; return 1; }
	reject_special "$v" "value" || return 1
	return 0
}

v_region_id() {
	local v="$1"
	is_uint "$v" || { verr "region id must be a positive number"; return 1; }
	((v >= 1 && v <= 65535)) || { verr "region id must be between 1 and 65535"; return 1; }
	return 0
}

v_container_path() {
	local v="$1"
	v_abs_path "$v" || return 1
	case "$v" in
	"$HS_ETC_CTR"/*) return 0 ;;
	"$HS_DATA_CTR"/*) return 0 ;;
	*)
		verr "path must be below $HS_ETC_CTR/ or $HS_DATA_CTR/ so this installer knows where it lives on the host"
		return 1
		;;
	esac
}

# -----------------------------------------------------------------------------
# Input helpers
# -----------------------------------------------------------------------------
read_input() { # outvar prompt [default]
	# NOTE: the internal variable is deliberately named __dii_line.  read_input
	# is called with the *caller's* variable name (for example "__reply"), and
	# "printf -v name" resolves in the innermost scope that defines it, so an
	# internal local with the same name would swallow the answer.
	local __dii_out="$1" __dii_prompt="$2" __dii_default="${3-}" __dii_line=""
	if ((USE_DEFAULTS)) && [[ -n $__dii_default ]]; then
		printf '%s [%s]: %s (--defaults)\n' "$__dii_prompt" "$__dii_default" "$__dii_default" >&2
		printf -v "$__dii_out" '%s' "$__dii_default"
		return 0
	fi
	if [[ -n $__dii_default ]]; then
		printf '%s [%s]: ' "$__dii_prompt" "$__dii_default" >&2
	else
		printf '%s: ' "$__dii_prompt" >&2
	fi
	if IFS= read -r __dii_line; then
		:
	else
		if [[ -n $__dii_default ]]; then
			printf '\n' >&2
			warn "standard input is closed (EOF); using the default value"
			__dii_line="$__dii_default"
		else
			die "standard input is closed (EOF) and this prompt has no default: $__dii_prompt"
		fi
	fi
	if [[ -z $__dii_line && -n $__dii_default ]]; then
		__dii_line="$__dii_default"
	fi
	printf -v "$__dii_out" '%s' "$__dii_line"
	return 0
}

read_secret() { # outvar prompt
	local __dii_out="$1" __dii_prompt="$2" __dii_line=""
	printf '%s (input hidden): ' "$__dii_prompt" >&2
	if IFS= read -rs __dii_line; then
		printf '\n' >&2
	else
		die "standard input is closed (EOF) while reading: $__dii_prompt"
	fi
	printf -v "$__dii_out" '%s' "$__dii_line"
	return 0
}

ask() { # outvar prompt default validator
	local __out="$1" __prompt="$2" __default="${3-}" __fn="$4" __reply="" __tries=0
	while :; do
		read_input __reply "$__prompt" "$__default"
		if "$__fn" "$__reply"; then
			printf -v "$__out" '%s' "$__reply"
			return 0
		fi
		__tries=$((__tries + 1))
		if ((__tries >= 5)); then
			if [[ -n $__default ]] && "$__fn" "$__default" 2>/dev/null; then
				warn "too many invalid answers; falling back to the default"
				printf -v "$__out" '%s' "$__default"
				return 0
			fi
			die "too many invalid answers for: $__prompt"
		fi
	done
}

confirm() { # prompt default(y|n)
	local __prompt="$1" __default="${2:-n}" __reply="" __tries=0
	if ((USE_DEFAULTS)); then
		printf '%s [%s]: %s (--defaults)\n' "$__prompt" "$__default" "$__default" >&2
		[[ $__default == y* ]] && return 0 || return 1
	fi
	while :; do
		read_input __reply "$__prompt (y/n)" "$__default"
		case "$__reply" in
		y | Y | yes | YES | Yes) return 0 ;;
		n | N | no | NO | No) return 1 ;;
		*) verr "answer y or n" ;;
		esac
		__tries=$((__tries + 1))
		if ((__tries >= 5)); then
			warn "too many unusable answers; using the default '$__default'"
			[[ $__default == y* ]] && return 0 || return 1
		fi
	done
}

choose_index() { # outvar prompt default_index label...
	local __out="$1" __prompt="$2" __default="$3"
	shift 3
	local -a __opts=("$@")
	local i=1 __o __reply="" __tries=0
	if ((USE_DEFAULTS)); then
		printf '%s [%s]: %s (--defaults)\n' "$__prompt" "$__default" "$__default" >&2
		printf -v "$__out" '%s' "$__default"
		return 0
	fi
	while :; do
		printf '%s\n' "$__prompt" >&2
		i=1
		for __o in "${__opts[@]}"; do
			printf '  %d) %s\n' "$i" "$__o" >&2
			i=$((i + 1))
		done
		read_input __reply "Choose" "$__default"
		if is_uint "$__reply" && ((${#__reply} > 0)) && ((__reply >= 1 && __reply <= ${#__opts[@]})); then
			printf -v "$__out" '%s' "$__reply"
			return 0
		fi
		verr "enter a number between 1 and ${#__opts[@]}"
		__tries=$((__tries + 1))
		if ((__tries >= 5)); then
			warn "too many unusable answers; using option $__default"
			printf -v "$__out" '%s' "$__default"
			return 0
		fi
	done
}

# -----------------------------------------------------------------------------
# YAML reading (best effort) and patching.  Both awk programs are kept in
# variables so no shell quoting can mangle them.
# -----------------------------------------------------------------------------
AWK_YAML_GET=$(
	cat <<'AWK'
function trim(s) { gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s); return s }
function strip_comment(v,   q) {
  if (v ~ /^"/) {
    q = index(substr(v, 2), "\"")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  if (v ~ /^'/) {
    q = index(substr(v, 2), "'")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  sub(/[ \t]+#.*$/, "", v)
  return v
}
{
  line = $0
  if (line ~ /^[ \t]*(#|$)/) next
  match(line, /^[ \t]*/); ind = RLENGTH
  body = substr(line, ind + 1)
  if (body !~ /^[A-Za-z0-9_.-]+[ \t]*:/) next
  k = body; sub(/[ \t]*:.*$/, "", k)
  v = body; sub(/^[^:]*:[ \t]*/, "", v)
  v = trim(strip_comment(v))
  while (depth > 0 && blockind[depth] >= ind) depth--
  if (v == "") { depth++; blockkey[depth] = k; blockind[depth] = ind; next }
  p = ""
  for (i = 1; i <= depth; i++) p = p blockkey[i] "."
  p = p k
  if (p == target) {
    sub(/^"/, "", v); sub(/"$/, "", v)
    sub(/^'/, "", v); sub(/'$/, "", v)
    print v
    exit
  }
}
AWK
)

# The items of one list block, one per line.  Used to check derp.paths before the
# install finishes: Headscale exits at start-up when a listed map is unreadable.
AWK_YAML_LIST=$(
	cat <<'AWK'
function trim(s) { gsub(/^[ \t]+/, "", s); gsub(/[ \t]+$/, "", s); return s }
function strip_comment(v,   q) {
  if (v ~ /^"/) {
    q = index(substr(v, 2), "\"")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  if (v ~ /^'/) {
    q = index(substr(v, 2), "'")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  sub(/[ \t]+#.*$/, "", v)
  return v
}
function unquote(v) {
  sub(/^"/, "", v); sub(/"$/, "", v)
  sub(/^'/, "", v); sub(/'$/, "", v)
  return v
}
{
  line = $0
  if (line ~ /^[ \t]*(#|$)/) next
  match(line, /^[ \t]*/); ind = RLENGTH
  body = substr(line, ind + 1)
  if (body ~ /^-([ \t]|$)/) {
    if (inblock && ind > bind) {
      item = body; sub(/^-[ \t]*/, "", item)
      print unquote(trim(strip_comment(item)))
    }
    next
  }
  if (body !~ /^[A-Za-z0-9_.-]+[ \t]*:/) next
  k = body; sub(/[ \t]*:.*$/, "", k)
  v = body; sub(/^[^:]*:[ \t]*/, "", v)
  v = trim(strip_comment(v))
  while (depth > 0 && blockind[depth] >= ind) depth--
  p = ""
  for (i = 1; i <= depth; i++) p = p (i > 1 ? "." : "") blockkey[i]
  if (v == "") {
    depth++; blockkey[depth] = k; blockind[depth] = ind
    p = p (depth > 1 ? "." : "") k
    inblock = (p == target); bind = ind
  } else {
    inblock = ((p == "" ? "" : p ".") k == target)
  }
}
AWK
)

AWK_PATCH=$(
	cat <<'AWK'
function spaces(n,   s, i) { s = ""; for (i = 0; i < n; i++) s = s " "; return s }
function logit(kind, p, old, new, note) {
  printf "%s\t%s\t%s\t%s\t%s\n", kind, p, old, new, note >> logfile
}
function block_end(idx,   j) {
  for (j = idx + 1; j <= N; j++) {
    if (content[j] && indent[j] <= indent[idx]) return j - 1
  }
  return N
}
function snippet(from, to, baseind, mode,   i, s, ind) {
  s = ""; ind = baseind
  for (i = from; i <= to; i++) {
    if (i < to) { s = s spaces(ind) part[i] ":\n"; ind = ind + 2 }
    else if (mode == "list") { s = s spaces(ind) part[i] ":\n" spaces(ind + 2) "- " sval[si] "\n" }
    else { s = s spaces(ind) part[i] ": " quote(sval[si], mode) "\n" }
  }
  return s
}
function quote(v, mode) {
  if (mode == "raw") return v
  return "\"" v "\""
}
function unquote(v) {
  sub(/^"/, "", v); sub(/"$/, "", v)
  sub(/^'/, "", v); sub(/'$/, "", v)
  return v
}
function strip_comment(v,   q) {
  if (v ~ /^"/) {
    q = index(substr(v, 2), "\"")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  if (v ~ /^'/) {
    q = index(substr(v, 2), "'")
    if (q > 0) return substr(v, 1, q + 1)
    return v
  }
  sub(/[ \t]+#.*$/, "", v)
  return v
}
# True for a derp.paths entry the Headscale container cannot read: the images
# only mount the config and data directories, so an absolute path outside them
# (typically a host path from the installation being migrated) is not there, and
# Headscale exits at start-up when a listed map cannot be read.
function unreadable(p) {
  if (p !~ /^\//) return 0
  if (p == ctr_etc || index(p, ctr_etc "/") == 1) return 0
  if (p == ctr_data || index(p, ctr_data "/") == 1) return 0
  return 1
}
function find_block(path,   j, best) {
  best = 0
  for (j = 1; j <= N; j++) {
    if (content[j] && path_of[j] == path && val[j] == "") best = j
  }
  return best
}
function join_path(parts, upto,   m, s) {
  s = ""
  for (m = 1; m <= upto; m++) s = s (m > 1 ? "." : "") parts[m]
  return s
}
# Deepest ancestor of "path" that can hold new keys.  Returns
# "depth SUBSEP insert_index SUBSEP kind SUBSEP indent" where kind is "r" for a
# block that already exists in the file (its indent is read from indent[]) or
# "v" for a block created by an earlier insertion in this same run.
function deep_ancestor(path,   n, parts, k, anc, best) {
  n = split(path, parts, ".")
  for (k = n - 1; k >= 1; k--) {
    anc = join_path(parts, k)
    best = find_block(anc)
    if (best > 0) return (k SUBSEP best SUBSEP "r" SUBSEP 0)
    if (anc in vpos) return (k SUBSEP vpos[anc] SUBSEP "v" SUBSEP vindent[anc])
  }
  return ""
}
# Remember the blocks a freshly inserted snippet created, so the next missing
# key nests inside the same block instead of starting a duplicate block.
function register_virtual(from, to, baseind, mode,   i, p) {
  for (i = from; i <= to; i++) {
    if (i == to && mode != "list") continue
    p = join_path(part, i)
    vpos[p] = vcur
    vindent[p] = baseind + 2 * (i - from)
  }
}
# "eof" is a bucket of its own: text appended at the end of the file must never
# be merged with text appended to the last existing block, or the indentation
# would nest the two pieces inside each other.
function append_insert(where, text) {
  if (where == "eof") eof_insert = eof_insert text
  else insert_after[where] = insert_after[where] text
}
BEGIN {
  while ((getline sline < specfile) > 0) {
    if (sline == "") continue
    nf = split(sline, f, "\t")
    if (nf < 3) continue
    ns++
    spath[ns] = f[1]; smode[ns] = f[2]; sval[ns] = f[3]
  }
  close(specfile)
  N = 0
}
{
  N++
  raw[N] = $0
  content[N] = 1
  line = $0
  if (line ~ /^[ \t]*(#|$)/) { content[N] = 0; next }
  match(line, /^[ \t]*/); ind = RLENGTH
  indent[N] = ind
  body = substr(line, ind + 1)
  if (body !~ /^[A-Za-z0-9_.-]+[ \t]*:/) { content[N] = 0; next }
  k = body; sub(/[ \t]*:.*$/, "", k)
  v = body; sub(/^[^:]*:[ \t]*/, "", v)
  v = strip_comment(v)
  sub(/[ \t]+$/, "", v)
  key[N] = k; val[N] = v
  while (depth > 0 && blockind[depth] >= ind) depth--
  if (v == "") {
    depth++
    blockkey[depth] = k; blockind[depth] = ind
    pp = ""
    for (i = 1; i <= depth; i++) pp = pp (i > 1 ? "." : "") blockkey[i]
    path_of[N] = pp
  } else {
    pp = ""
    for (i = 1; i <= depth; i++) pp = pp blockkey[i] "."
    path_of[N] = pp k
  }
}
END {
  for (si = 1; si <= ns; si++) {
    leaf = 0
    for (j = 1; j <= N; j++) {
      if (content[j] && path_of[j] == spath[si]) leaf = j
    }

    if (leaf > 0 && val[leaf] != "") {
      if (smode[si] == "list") {
        logit("MANUAL", spath[si], val[leaf], sval[si], "expected a list block but the key holds a scalar; edit it by hand")
        continue
      }
      cur = unquote(val[leaf])
      if (cur == sval[si]) continue
      newval[leaf] = quote(sval[si], smode[si])
      logit("CHANGE", spath[si], val[leaf], quote(sval[si], smode[si]), "")
      continue
    }

    if (leaf > 0 && val[leaf] == "") {
      if (smode[si] == "list") {
        be = block_end(leaf)
        found = 0; stale = 0
        pdir = sval[si]; sub(/\/[^\/]*$/, "", pdir)
        for (j = leaf + 1; j <= be; j++) {
          item = raw[j]
          if (item !~ /^[ \t]*-[ \t]*/) continue
          sub(/^[ \t]*-[ \t]*/, "", item); sub(/[ \t]+$/, "", item)
          item = unquote(strip_comment(item))
          if (item == sval[si]) found = 1
          if (unreadable(item)) {
            stale++
            stale_line[stale] = j
            sold[stale] = item
          } else {
            kept[item] = 1
          }
        }
        if (found) continue
        primary = 0
        # Every unreadable entry was placed next to the map the installer writes
        # (migration copies derp-maps/ there), so point the line at that copy
        # instead of leaving a path the container cannot open.
        for (st = 1; st <= stale; st++) {
          j = stale_line[st]
          base = sold[st]; sub(/^.*\//, "", base)
          mapped = pdir "/" base
          if (mapped == sval[si]) primary = 1
          if (mapped in kept) {
            dropped[j] = 1
            logit("DROP", spath[si], sold[st], "", "another entry resolves to the same file; loading it twice would duplicate the maps")
            continue
          }
          kept[mapped] = 1
          raw[j] = spaces(indent[leaf] + 2) "- " mapped
          logit("CHANGE", spath[si], sold[st], mapped, "old host path rewritten to the map inside the mounted config directory")
        }
        if (!primary) {
          insert_after[be] = insert_after[be] spaces(indent[leaf] + 2) "- " sval[si] "\n"
          logit("ADD", spath[si], "(not listed)", sval[si], "")
        }
        continue
      }
      logit("MANUAL", spath[si], "(block)", sval[si], "key exists as a block; not rewritten automatically")
      continue
    }

    n = split(spath[si], part, ".")
    placed = 0
    anc = deep_ancestor(spath[si])
    if (anc != "") {
      split(anc, ap, SUBSEP)
      k = ap[1] + 0; pos = ap[2]
      if (ap[3] == "v") base = (ap[4] + 0) + 2
      else base = indent[pos + 0] + 2
      vcur = pos
      append_insert(pos, snippet(k + 1, n, base, smode[si]))
      register_virtual(k + 1, n, base, smode[si])
      placed = 1
    }
    if (!placed) {
      vcur = "eof"
      append_insert("eof", snippet(1, n, 0, smode[si]))
      register_virtual(1, n, 0, smode[si])
    }
    logit("ADD", spath[si], "(absent)", quote(sval[si], smode[si]), "")
  }

  for (j = 1; j <= N; j++) {
    if (j in dropped) continue
    if (j in newval) printf "%s%s: %s\n", spaces(indent[j]), key[j], newval[j]
    else printf "%s\n", raw[j]
    if (j in insert_after) printf "%s", insert_after[j]
  }
  printf "%s", eof_insert
}
AWK
)

yaml_get() { # file dotted.key
	local file="$1" key="$2"
	[[ -r $file ]] || return 1
	awk -v target="$key" "$AWK_YAML_GET" "$file" 2>/dev/null || true
}

yaml_list() { # file dotted.key -> one item per line
	local file="$1" key="$2"
	[[ -r $file ]] || return 1
	awk -v target="$key" "$AWK_YAML_LIST" "$file" 2>/dev/null || true
}

# The host path behind a container path, for the two directories the images
# mount.  Prints nothing and fails for anything else.
container_to_host_path() {
	local p="$1"
	case "$p" in
	"$HS_ETC_CTR"/*) printf '%s/%s' "$HS_ETC" "${p#"$HS_ETC_CTR"/}" ;;
	"$HS_ETC_CTR") printf '%s' "$HS_ETC" ;;
	"$HS_DATA_CTR"/*) printf '%s/%s' "$HS_DATA" "${p#"$HS_DATA_CTR"/}" ;;
	"$HS_DATA_CTR") printf '%s' "$HS_DATA" ;;
	*) return 1 ;;
	esac
}

# Headscale refuses to start when a derp.paths entry names a file it cannot read,
# so an install that leaves one behind looks successful and then crashes.  Every
# entry of the written config is resolved back to its host path here; anything
# missing stops a real run before the containers are started (a dry run only
# reports what it sees, because migration and the placeholder still have to run).
verify_derp_paths() { # <written or previewed yaml> <real|plan>
	local file="$1" phase="${2:-real}" entry host base bad=0 listed=0 ok=0
	while IFS= read -r entry; do
		[[ -n $entry ]] || continue
		listed=1
		if ! host="$(container_to_host_path "$entry")"; then
			warn "derp.paths entry $entry is outside $HS_ETC_CTR and $HS_DATA_CTR; the Headscale container cannot read it"
			bad=$((bad + 1))
			continue
		fi
		base="${entry##*/}"
		ok=0
		[[ -e $host ]] && ok=1
		[[ $entry == "$DERP_MAP_CTR" && $host == "$DERP_MAP_HOST" ]] && ok=1
		[[ -n $MIGRATE_SRC && -e "$MIGRATE_SRC/derp-maps/$base" ]] && ok=1
		if ((ok == 1)); then
			dim "  derp.paths ok: $entry"
			continue
		fi
		warn "derp.paths entry $entry has no file behind it ($host)"
		bad=$((bad + 1))
	done < <(yaml_list "$file" "derp.paths" || true)
	((listed)) || return 0
	((bad == 0)) && return 0
	if [[ $phase == "real" ]]; then
		die "$bad derp.paths entry/entries would stop Headscale at start-up; put each map in $DERP_MAP_DIR (the directory both containers mount) or drop the line, then re-run"
	fi
	warn "$bad derp.paths entry/entries of the planned config would stop Headscale at start-up"
	return 0
}

patch_config() { # src spec logfile  (patched YAML on stdout)
	local src="$1" spec="$2" log="$3"
	awk -v specfile="$spec" -v logfile="$log" -v ctr_etc="$HS_ETC_CTR" -v ctr_data="$HS_DATA_CTR" "$AWK_PATCH" "$src"
}

# -----------------------------------------------------------------------------
# Ports
# -----------------------------------------------------------------------------
listening_sockets() {
	if have ss; then
		ss -lntu 2>/dev/null && return 0
	fi
	if have netstat; then
		netstat -lntu 2>/dev/null && return 0
	fi
	return 1
}

warn_port_conflict() { # port proto label
	local port="$1" proto="$2" label="$3" out=""
	if ! out="$(listening_sockets)"; then
		dim "  (port check skipped: neither 'ss' nor 'netstat' could list sockets)"
		return 0
	fi
	if printf '%s\n' "$out" | grep -Eq "[:.]$port([[:space:]]|$)"; then
		warn "$label: something is already listening on $proto/$port (the native Headscale may still be running; stop it before 'docker compose up -d')"
	else
		ok "  $label: $proto/$port looks free"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Actions.  Every write goes through one of these, so --dry-run can never
# change anything outside the private temporary directory.
# -----------------------------------------------------------------------------
act_mkdir() {
	local d="$1" mode="${2:-755}"
	if ((DRY_RUN)); then
		emit "  [dry-run] mkdir -p -m $mode $d"
		return 0
	fi
	if [[ -d $d ]]; then
		dim "  exists: $d"
	else
		mkdir -p "$d"
		chmod "$mode" "$d" 2>/dev/null || true
		ok "  created: $d"
	fi
	return 0
}

act_backup_file() { # path
	local f="$1" ts="$2" b
	b="$f.bak-$ts"
	if ((DRY_RUN)); then
		[[ -e $f ]] && emit "  [dry-run] cp -a $f $b"
		return 0
	fi
	if [[ -e $f ]]; then
		cp -a "$f" "$b"
		BACKUP_FILES+=("$b")
		ok "  backed up: $f -> $b"
	fi
	return 0
}

act_copy() { # src dst [mode] [label]
	local src="$1" dst="$2" mode="${3:-}" label="${4:-}"
	if [[ ! -e $src ]]; then
		warn "missing source, skipped: $src"
		return 0
	fi
	if ((DRY_RUN)); then
		[[ -e $dst ]] && emit "  [dry-run] cp -a $dst $dst.bak-$RUN_STAMP (existing destination kept)"
		emit "  [dry-run] cp -a $src $dst${mode:+ && chmod $mode $dst}"
		COPIED_FILES+=("$src -> $dst")
		return 0
	fi
	if [[ -e $dst ]]; then
		act_backup_file "$dst" "$RUN_STAMP"
	fi
	mkdir -p "$(dirname "$dst")"
	cp -a "$src" "$dst"
	if [[ -n $mode ]]; then
		chmod "$mode" "$dst" 2>/dev/null || warn "could not chmod $mode $dst"
	fi
	COPIED_FILES+=("$src -> $dst")
	local extra=""
	if have sha256sum; then
		extra=" sha256=$(sha256sum "$src" | awk '{print $1}')"
	fi
	ok "  copied: $src -> $dst (${label:-file})$extra"
	return 0
}

# stage_file <final path> <mode> <content on stdin>
stage_file() {
	local final="$1" mode="${2:-644}" staged content_file
	content_file="$(new_tmp_file)"
	cat >"$content_file"
	if ((DRY_RUN)); then
		if [[ -z $STAGE_DIR ]]; then
			STAGE_DIR="$(mktemp -d "$TMP_ROOT/stage.XXXXXX")"
			TMP_DIRS+=("$STAGE_DIR")
		fi
		staged="$STAGE_DIR/$(printf '%s' "$final" | tr '/' '_')"
		cp "$content_file" "$staged"
		WRITTEN_FILES+=("$final (mode $mode)")
		emit ""
		emit "--- would write: $final (mode $mode) ---"
		mask_config_lines <"$content_file"
		emit "--- end: $final ---"
		return 0
	fi
	local dir tmp
	dir="$(dirname "$final")"
	mkdir -p "$dir"
	tmp="$(mktemp "$dir/.$(basename "$final").tmp.XXXXXX")"
	TMP_FILES+=("$tmp")
	chmod "$mode" "$tmp" 2>/dev/null || true
	cat "$content_file" >"$tmp"
	mv -f "$tmp" "$final"
	chmod "$mode" "$final" 2>/dev/null || warn "could not chmod $mode $final"
	WRITTEN_FILES+=("$final (mode $mode)")
	ok "  wrote: $final (mode $mode)"
	return 0
}

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
preflight() {
	head2 "Preflight"
	if [[ $(id -u) -eq 0 ]]; then
		ROOT_UID=1
		ok "running as root"
	else
		warn "not running as root: file ownership cannot be fixed for the containers (run with sudo if you hit permission errors)"
	fi
	local missing=()
	if ! have docker; then
		missing+=("docker (the Docker CLI is not in PATH)")
	else
		if docker compose version >/dev/null 2>&1; then
			ok "docker + docker compose plugin found"
		else
			missing+=("the 'docker compose' plugin (docker: $(docker --version 2>/dev/null || echo unknown))")
		fi
	fi
	if ((${#missing[@]} > 0)); then
		if ((DRY_RUN)); then
			warn "missing: ${missing[*]}"
			warn "continuing because --dry-run changes nothing; a real run would stop here"
		else
			local m
			err "this installer needs the following and will not continue:"
			for m in "${missing[@]}"; do
				err "  - $m"
			done
			err "install Docker + the Compose plugin, or re-run with --dry-run to see the plan only"
			exit 1
		fi
	fi
	if have openssl; then HAVE_OPENSSL=1; fi
	if have curl; then HAVE_CURL=1; fi
	if [[ -r /etc/timezone ]]; then
		TZONE="$(trim "$(head -n 1 /etc/timezone 2>/dev/null || true)")"
	elif [[ -L /etc/localtime ]]; then
		local link
		link="$(readlink /etc/localtime 2>/dev/null || true)"
		if [[ $link == *zoneinfo/* ]]; then
			TZONE="${link##*zoneinfo/}"
		fi
	fi
	if [[ -z $TZONE ]]; then
		TZONE="$DEFAULT_TZ_FALLBACK"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 1: base directory
# -----------------------------------------------------------------------------
step_base_dir() {
	head2 "Step 1/9  Base directory and directory layout"
	local candidate="$DEFAULT_BASE_DIR"
	if [[ -n ${OPT_BASE_DIR:-} ]]; then
		candidate="$OPT_BASE_DIR"
	elif [[ -f ./docker-compose.yml || -f ./config.yaml ]]; then
		candidate="$(pwd)"
		dim "an existing config.yaml / docker-compose.yml was found here, using this directory as the default"
	fi

	local tries=0 reply depth probe
	while :; do
		if [[ -n ${OPT_BASE_DIR:-} && $tries -eq 0 ]]; then
			reply="$OPT_BASE_DIR"
			printf 'Base data directory [%s]: %s (--base-dir)\n' "$candidate" "$reply" >&2
		else
			read_input reply "Base data directory (compose file, HeadplaneCN config and data live here)" "$candidate"
		fi
		if ! v_abs_path "$reply"; then
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the base directory"
			continue
		fi
		reply="$(norm_path "$reply")"
		case "$reply" in
		/ | /etc | /usr | /bin | /sbin | /boot | /var | /root | /tmp)
			warn "'$reply' looks like a system directory; pick a dedicated folder such as $DEFAULT_BASE_DIR"
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the base directory"
			continue
			;;
		esac
		# Writability, without touching the disk: only the deepest existing
		# ancestor is probed.  Creating the directory and writing a probe file
		# here contradicted the promise printed in MODE above (files are written
		# once the plan is confirmed); the real mkdir -p runs in the write phase,
		# which reports any remaining failure there.
		if [[ -e $reply && ! -d $reply ]]; then
			warn "'$reply' exists and is not a directory; choose another path"
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the base directory"
			continue
		fi
		probe="$(path_deepest_existing "$reply")"
		if [[ ! -w $probe ]]; then
			warn "'$probe' is not writable by $(id -un); choose another path or re-run with sudo"
			tries=$((tries + 1))
			((tries >= 5)) && die "too many invalid answers for the base directory"
			continue
		fi
		BASE_DIR="$reply"
		break
	done

	# ---------------------------------------------------------------------
	# Directory layout.  Every path is asked for, defaulted from the base
	# directory, validated, and printed again by print_plan before anything
	# is written.  Only the host side is chosen here: the container paths are
	# fixed by the two images and are the same in both services.
	# ---------------------------------------------------------------------
	local base="$BASE_DIR"
	say ""
	say "The five paths below are used verbatim as the host side of the volumes:"
	say "entries, so both containers mount the same host paths at identical container"
	say "paths. Press Enter to accept the default in brackets."
	ask HP_CONFIG "HeadplaneCN config file (created with mode 600; an existing file is patched, never replaced)" "$base/config.yaml" v_host_file
	HP_CONFIG="$(norm_path "$HP_CONFIG")"
	ask HP_DATA "HeadplaneCN data directory (sessions, internal database, config snapshots)" "$base/data" v_host_dir
	HP_DATA="$(norm_path "$HP_DATA")"
	ask HS_ETC "Headscale config directory (holds config.yaml, policy.hujson and the DERP maps)" "$base/etc/headscale" v_host_dir
	HS_ETC="$(norm_path "$HS_ETC")"
	ask HS_DATA "Headscale data directory (holds db.sqlite and noise_private.key)" "$base/data/headscale" v_host_dir
	HS_DATA="$(norm_path "$HS_DATA")"
	ask DERP_MAP_DIR "DERP map directory inside the Headscale config directory (holds $DEFAULT_DERP_MAP_NAME)" "$HS_ETC/$DEFAULT_DERP_DIR_NAME" v_derp_dir
	DERP_MAP_DIR="$(norm_path "$DERP_MAP_DIR")"

	DERP_DIR_CTR="$(derp_container_dir "$DERP_MAP_DIR" "$HS_ETC" "$HS_ETC_CTR")"
	DERP_MAP_CTR="$DERP_DIR_CTR/$DEFAULT_DERP_MAP_NAME"
	DERP_MAP_HOST="$DERP_MAP_DIR/$DEFAULT_DERP_MAP_NAME"
	v_container_path "$DERP_MAP_CTR" ||
		die "internal error: the derived DERP map path is not below $HS_ETC_CTR: $DERP_MAP_CTR"

	COMPOSE_FILE="$BASE_DIR/docker-compose.yml"
	BACKUP_DIR="$BASE_DIR/backups"
	warn_layout_collisions
	# The recursive chown of the Headscale directories happens later, so a layout
	# that would hand it unrelated files is rejected here, before anything exists.
	v_recursive_chown_target "$HS_ETC" || die "refusing to change the ownership of $HS_ETC recursively"
	v_recursive_chown_target "$HS_DATA" || die "refusing to change the ownership of $HS_DATA recursively"
	ok "base directory: $BASE_DIR"
	confirm "These directories will hold the Headscale database and private keys (back them up regularly). Understood?" y ||
		die "aborted by the operator"
	dim "  the resolved layout is printed again in the plan, before anything is written"
	return 0
}

# -----------------------------------------------------------------------------
# Step 2: images
# -----------------------------------------------------------------------------
step_images() {
	head2 "Step 2/9  Container images to pin"
	if [[ -n ${OPT_HS_IMAGE:-} ]]; then
		v_image_ref "$OPT_HS_IMAGE" || die "invalid --headscale-tag: $OPT_HS_IMAGE"
		HS_IMAGE="$OPT_HS_IMAGE"
		printf 'Headscale image [%s]: %s (--headscale-tag)\n' "$DEFAULT_HS_IMAGE" "$HS_IMAGE" >&2
	else
		ask HS_IMAGE "Headscale image (repo:tag, pinned)" "$DEFAULT_HS_IMAGE" v_image_ref
	fi
	if [[ -n ${OPT_HP_IMAGE:-} ]]; then
		v_image_ref "$OPT_HP_IMAGE" || die "invalid --headplane-tag: $OPT_HP_IMAGE"
		HP_IMAGE="$OPT_HP_IMAGE"
		printf 'HeadplaneCN image [%s]: %s (--headplane-tag)\n' "$DEFAULT_HP_IMAGE" "$HP_IMAGE" >&2
	else
		ask HP_IMAGE "HeadplaneCN image (repo:tag, pinned)" "$DEFAULT_HP_IMAGE" v_image_ref
	fi
	dim "  these two tags are the version lock; upgrading means editing them in the compose file"
	return 0
}

# -----------------------------------------------------------------------------
# Step 3: URLs
# -----------------------------------------------------------------------------
split_url() { # url -> sets url_scheme url_host url_port
	local url="$1" rest="${1#*://}"
	url_scheme="${url%%://*}"
	rest="${url#*://}"
	url_host="$rest"
	url_port=""
	if [[ $rest == *:* ]]; then
		url_host="${rest%:*}"
		url_port="${rest##*:}"
	fi
	[[ -n $url_port ]] || {
		if [[ $url_scheme == https ]]; then url_port=443; else url_port=80; fi
	}
	return 0
}

step_urls() {
	head2 "Step 3/9  Client URL, DERP and admin UI"
	local existing_url="" d
	existing_url="$(yaml_get "$HS_ETC/config.yaml" "server_url" 2>/dev/null || true)"
	[[ -n $existing_url ]] || existing_url="$(yaml_get "$HP_CONFIG" "headscale.public_url" 2>/dev/null || true)"
	local url_default="$DEFAULT_SERVER_URL"
	[[ -n $existing_url ]] && url_default="$existing_url"

	if [[ -n ${OPT_SERVER_URL:-} ]]; then
		v_http_url "$OPT_SERVER_URL" || die "invalid --server-url: $OPT_SERVER_URL"
		SERVER_URL="$OPT_SERVER_URL"
		printf 'Client server_url [%s]: %s (--server-url)\n' "$url_default" "$SERVER_URL" >&2
	else
		say "This is the address clients register against (Headscale's server_url)."
		say "If you are migrating, it MUST stay byte-for-byte identical to the current value."
		ask SERVER_URL "Client server_url (scheme://host[:port])" "$url_default" v_http_url
	fi
	split_url "$SERVER_URL"
	CLIENT_SCHEME="$url_scheme"
	CLIENT_HOST="$url_host"
	CLIENT_PORT="$url_port"

	if [[ -n ${OPT_DERP_HOST:-} ]]; then
		v_host_port_opt "$OPT_DERP_HOST" || die "invalid --derp-host: $OPT_DERP_HOST"
		DERP_HOST="$OPT_DERP_HOST"
		printf 'Embedded DERP host[:port] [none]: %s (--derp-host)\n' "$DERP_HOST" >&2
	else
		say ""
		say "Optional: a second public hostname that also serves /derp (answer 'none' if the"
		say "client hostname above is enough - it always has to serve /derp anyway)."
		ask DERP_HOST "Embedded DERP host[:port], or none" "none" v_host_port_opt
	fi
	if [[ $DERP_HOST == "none" || $DERP_HOST == "direct" || -z $DERP_HOST ]]; then
		DERP_URL="$SERVER_URL"
		DERP_HOST="none"
	else
		local dh="${DERP_HOST%:*}" dp="${DERP_HOST##*:}"
		[[ $DERP_HOST == *:* ]] || dp="$CLIENT_PORT"
		DERP_URL="$CLIENT_SCHEME://$dh:$dp"
	fi

	if [[ -n ${OPT_ADMIN_HOST:-} ]]; then
		v_host_port_opt "$OPT_ADMIN_HOST" || die "invalid --admin-host: $OPT_ADMIN_HOST"
		ADMIN_HOST="$OPT_ADMIN_HOST"
		printf 'Admin UI host[:port] [none]: %s (--admin-host)\n' "$ADMIN_HOST" >&2
	else
		say ""
		say "Optional: a separate hostname for the HeadplaneCN admin UI. Answer 'none' to reuse"
		say "the client URL (the UI is then at <client url>/admin)."
		ask ADMIN_HOST "Admin UI host[:port], or none" "none" v_host_port_opt
	fi
	if [[ $ADMIN_HOST == "none" || $ADMIN_HOST == "direct" || -z $ADMIN_HOST ]]; then
		ADMIN_URL="$SERVER_URL"
		ADMIN_HOST="none"
	else
		local ah="${ADMIN_HOST%:*}" ap="${ADMIN_HOST##*:}"
		[[ $ADMIN_HOST == *:* ]] || ap="$CLIENT_PORT"
		ADMIN_URL="$CLIENT_SCHEME://$ah:$ap"
	fi
	# server.base_url must NOT include /admin (the dashboard prefix is appended by the UI)
	BASE_URL="$ADMIN_URL"
	if [[ $ADMIN_HOST == "none" ]]; then
		dim "  server.base_url defaults to the client URL; the UI is at $BASE_URL/admin"
	else
		dim "  server.base_url = admin URL; the UI is at $BASE_URL/admin"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 4: networking, ports, timezone
# -----------------------------------------------------------------------------
step_network() {
	head2 "Step 4/9  Networking, ports and timezone"
	if confirm "Use host networking for both containers (recommended)?" y; then
		HOST_NETWORK=1
		dim "  host networking: no ports: section is written - the containers bind 8080/9090/udp-3478 and the"
		dim "  admin port directly on this machine, and 127.0.0.1 inside a container is this machine"
	else
		HOST_NETWORK=0
		dim "  bridge networking: the compose file publishes 8080, 127.0.0.1:9090, udp/<stun> and the admin"
		dim "  port, and HeadplaneCN reaches Headscale as http://headscale:8080 instead of 127.0.0.1"
	fi

	# HeadplaneCN listen port
	local hp_default="$DEFAULT_ADMIN_PORT"
	local hp_existing=""
	hp_existing="$(yaml_get "$HP_CONFIG" "server.port" 2>/dev/null || true)"
	[[ -n $hp_existing ]] && hp_default="$hp_existing"
	if [[ -n ${OPT_HP_PORT:-} ]]; then
		v_port "$OPT_HP_PORT" || die "invalid --admin-port: $OPT_HP_PORT"
		HP_PORT="$OPT_HP_PORT"
		printf 'HeadplaneCN listen port [%s]: %s (--admin-port)\n' "$hp_default" "$HP_PORT" >&2
	else
		ask HP_PORT "HeadplaneCN listen port (the reverse proxy points at this)" "$hp_default" v_port
	fi
	if [[ $HP_PORT == "$DEFAULT_HS_PORT" || $HP_PORT == "$DEFAULT_METRICS_PORT" ]]; then
		warn "$HP_PORT is already used by Headscale ($DEFAULT_HS_PORT control / $DEFAULT_METRICS_PORT metrics)"
		ask HP_PORT "HeadplaneCN listen port (must differ from $DEFAULT_HS_PORT and $DEFAULT_METRICS_PORT)" "$DEFAULT_ADMIN_PORT" v_port
	fi

	# Admin UI exposure. The dashboard is the most sensitive surface on this machine:
	# metrics are localhost-only by default, so make the admin port ask the same
	# question instead of silently publishing it on every interface. In bridge mode
	# the published address decides, because the container itself must listen on
	# 0.0.0.0 for docker to forward the port.
	if [[ -n ${OPT_ADMIN_BIND:-} ]]; then
		case "$OPT_ADMIN_BIND" in
			0.0.0.0 | 127.0.0.1) ADMIN_BIND="$OPT_ADMIN_BIND" ;;
			*) die "invalid --admin-bind: $OPT_ADMIN_BIND (use 0.0.0.0 or 127.0.0.1)" ;;
		esac
		printf 'Admin UI bind address [0.0.0.0]: %s (--admin-bind)\n' "$ADMIN_BIND" >&2
	else
		local ab=""
		if ((HOST_NETWORK == 1)); then
			choose_index ab "HeadplaneCN listen address:" 1 \
				"0.0.0.0  (all interfaces - reachable from the LAN, recommended)" \
				"127.0.0.1  (local only - put the reverse proxy on this machine)"
		else
			choose_index ab "Publish the HeadplaneCN admin port:" 1 \
				"$HP_PORT on all interfaces  (reachable from the LAN, recommended)" \
				"127.0.0.1:$HP_PORT  (local only - put the reverse proxy on this machine)"
		fi
		if [[ $ab == "2" ]]; then
			ADMIN_BIND="127.0.0.1"
		else
			ADMIN_BIND="0.0.0.0"
		fi
	fi
	if ((HOST_NETWORK == 1)); then
		HP_LISTEN_ADDR="$ADMIN_BIND"
	else
		HP_LISTEN_ADDR="0.0.0.0"
	fi
	if [[ $ADMIN_BIND == "127.0.0.1" ]]; then
		dim "  the admin UI is only reachable on 127.0.0.1:$HP_PORT of this machine"
	else
		warn "the admin UI is reachable on every interface of this machine (tcp/$HP_PORT); firewall it or put a TLS reverse proxy in front of it"
	fi

	# STUN
	if [[ -n ${OPT_STUN_PORT:-} ]]; then
		v_port "$OPT_STUN_PORT" || die "invalid --stun-port: $OPT_STUN_PORT"
		STUN_PORT="$OPT_STUN_PORT"
		printf 'STUN udp port [%s]: %s (--stun-port)\n' "$DEFAULT_STUN_PORT" "$STUN_PORT" >&2
	else
		ask STUN_PORT "STUN udp port announced by the embedded DERP" "$DEFAULT_STUN_PORT" v_port
	fi

	# metrics
	if ((HOST_NETWORK == 0)); then
		METRICS_ADDR="0.0.0.0:$DEFAULT_METRICS_PORT"
		dim "  bridge mode: Headscale metrics listen on $METRICS_ADDR inside the container and are published"
		dim "  as 127.0.0.1:$DEFAULT_METRICS_PORT on this machine"
	else
		local mi=""
		choose_index mi "Headscale metrics listen address:" 1 \
			"127.0.0.1:$DEFAULT_METRICS_PORT  (local only - recommended)" \
			"0.0.0.0:$DEFAULT_METRICS_PORT  (all interfaces - only if you restrict it yourself)"
		if [[ $mi == "2" ]]; then
			METRICS_ADDR="0.0.0.0:$DEFAULT_METRICS_PORT"
			warn "metrics will be reachable from the whole LAN; do not expose $DEFAULT_METRICS_PORT to the internet"
		else
			METRICS_ADDR="127.0.0.1:$DEFAULT_METRICS_PORT"
		fi
	fi

	# timezone
	if [[ -n ${OPT_TZ:-} ]]; then
		v_tz "$OPT_TZ" || die "invalid --tz: $OPT_TZ"
		TZONE="$OPT_TZ"
		printf 'Timezone [%s]: %s (--tz)\n' "$TZONE" "$TZONE" >&2
	else
		ask TZONE "Timezone for both containers" "$TZONE" v_tz
	fi

	# port conflicts (warn only)
	say ""
	say "Checking whether these ports are already in use:"
	warn_port_conflict "$DEFAULT_HS_PORT" "tcp" "Headscale control"
	warn_port_conflict "${METRICS_ADDR##*:}" "tcp" "Headscale metrics"
	warn_port_conflict "$STUN_PORT" "udp" "embedded DERP STUN"
	warn_port_conflict "$HP_PORT" "tcp" "HeadplaneCN"

	if [[ $CLIENT_PORT == "$DEFAULT_HS_PORT" || $CLIENT_PORT == "$HP_PORT" || $CLIENT_PORT == "$DEFAULT_METRICS_PORT" ]]; then
		warn "the public client port $CLIENT_PORT is also used by a local listener; that is fine only if the reverse proxy runs on another machine"
	fi
	if [[ $STUN_PORT == "$DEFAULT_HS_PORT" || $STUN_PORT == "$HP_PORT" || $STUN_PORT == "$DEFAULT_METRICS_PORT" ]]; then
		warn "the STUN port $STUN_PORT equals a TCP listener port; UDP and TCP can coexist, but double-check your proxy"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 5: secrets
# -----------------------------------------------------------------------------
generate_cookie_secret() {
	local s=""
	if ((HAVE_OPENSSL)); then
		s="$(openssl rand -base64 24 2>/dev/null | tr -d '\n' | cut -c1-32)"
	elif [[ -r /dev/urandom ]]; then
		s="$(head -c 24 /dev/urandom | base64 | tr -d '\n' | cut -c1-32)"
	fi
	if ((${#s} != 32)); then
		die "could not generate a 32 character secret (openssl missing and /dev/urandom unreadable); create one with: openssl rand -base64 24"
	fi
	printf '%s' "$s"
}

step_secrets() {
	head2 "Step 5/9  Secrets (API key and cookie secret)"
	say "A Headscale API key is required for the config check, config saves and the HeadplaneCN agent."
	say "It is only shown once when created:  docker compose exec headscale headscale apikeys create"
	local choice="" key="" kf=""
	choose_index choice "Headscale API key:" 2 \
		"Use an existing API key (paste it now, input hidden)" \
		"Leave it blank for now (an instruction is printed and written into the config)" \
		"Read the key from a file (for example /root/hskey.txt)"
	case "$choice" in
	1)
		read_secret key "Paste the Headscale API key"
		if ! v_nonempty "$key"; then
			die "empty API key; re-run and choose option 2 to leave it blank"
		fi
		[[ $key == hskey-* ]] || warn "this does not look like a Headscale API key (they start with 'hskey-')"
		API_KEY="$key"
		API_KEY_STATE="set"
		ok "  API key accepted: $(mask_secret "$API_KEY")"
		;;
	3)
		read_input kf "Path to the file containing the API key" "" 
		v_abs_path "$kf" || die "invalid path: $kf"
		[[ -r $kf ]] || die "cannot read $kf"
		API_KEY="$(trim "$(head -n 1 "$kf")")"
		v_nonempty "$API_KEY" || die "$kf is empty"
		reject_special "$API_KEY" "API key" || die "the key in $kf contains unsupported characters"
		API_KEY_STATE="set"
		ok "  API key read from $kf: $(mask_secret "$API_KEY")"
		;;
	*)
		API_KEY=""
		API_KEY_STATE="blank"
		API_KEY_NEEDED_HINT=1
		warn "no API key: login, the config check and the agent stay disabled until you add one"
		say "  create one later with:"
		say "    cd $BASE_DIR && docker compose exec headscale headscale apikeys create"
		say "  then put the full key into headscale.api_key in $HP_CONFIG"
		;;
	esac

	say ""
	local existing_cookie=""
	existing_cookie="$(yaml_get "$HP_CONFIG" "server.cookie_secret" 2>/dev/null || true)"
	KEEP_COOKIE=0
	if [[ -n $existing_cookie && $existing_cookie != *"change_me"* ]]; then
		if confirm "An existing cookie_secret was found in $HP_CONFIG - keep it (keeps current sessions valid)?" y; then
			KEEP_COOKIE=1
			COOKIE_SECRET="$existing_cookie"
			COOKIE_STATE="existing value kept ($(mask_secret "$COOKIE_SECRET"))"
			ok "  keeping the existing cookie_secret: $(mask_secret "$COOKIE_SECRET")"
		fi
	fi
	if ((KEEP_COOKIE == 0)); then
		if confirm "Generate a random 32 character cookie_secret now?" y; then
			COOKIE_SECRET="$(generate_cookie_secret)"
			COOKIE_STATE="generated ($(mask_secret "$COOKIE_SECRET"))"
			ok "  generated cookie_secret: $(mask_secret "$COOKIE_SECRET")"
			dim "  the real value is written to $HP_CONFIG (mode 600); rotate it by re-running this installer"
		else
			read_secret COOKIE_SECRET "Paste the existing cookie_secret (exactly 32 characters)"
			v_secret32 "$COOKIE_SECRET" || die "the cookie_secret must be exactly 32 characters"
			COOKIE_STATE="provided by the operator ($(mask_secret "$COOKIE_SECRET"))"
			ok "  cookie_secret accepted: $(mask_secret "$COOKIE_SECRET")"
		fi
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Step 6: DERP map file and region
# -----------------------------------------------------------------------------
step_derp() {
	head2 "Step 6/9  Embedded DERP"
	if [[ -n ${OPT_REGION_ID:-} ]]; then
		v_region_id "$OPT_REGION_ID" || die "invalid --region-id: $OPT_REGION_ID"
		REGION_ID="$OPT_REGION_ID"
		printf 'DERP region id [%s]: %s (--region-id)\n' "$DEFAULT_REGION_ID" "$REGION_ID" >&2
	else
		ask REGION_ID "DERP region id" "$DEFAULT_REGION_ID" v_region_id
	fi
	ask REGION_CODE "DERP region code" "$DEFAULT_REGION_CODE" v_nonempty
	ask REGION_NAME "DERP region name" "$DEFAULT_REGION_NAME" v_nonempty
	# The DERP map directory was chosen in step 1 and is inside the Headscale
	# config directory, so its container path follows from that mount.
	ok "  the map file will be created on the host at $DERP_MAP_HOST and is mounted as $DERP_MAP_CTR"
	dim "  DERP map directory: $DERP_MAP_DIR -> $DERP_DIR_CTR (rw in both containers)"
	return 0
}

# -----------------------------------------------------------------------------
# Step 7: migration plan
# -----------------------------------------------------------------------------
step_migration() {
	head2 "Step 7/9  Migrate an existing Headscale installation (optional)"
	if [[ -f $HS_ETC/config.yaml ]]; then
		dim "  $HS_ETC/config.yaml already exists; the installer will adopt and patch it instead of copying"
	fi
	if ! confirm "Copy data from an existing Headscale data directory (for example /vol1/@appdata/headscale)?" n; then
		MIGRATE_ACTIVE=0
		return 0
	fi
	local src reply
	read_input reply "Existing Headscale data directory" "/vol1/@appdata/headscale"
	v_abs_path "$reply" || die "invalid path: $reply"
	src="$(norm_path "$reply")"
	[[ -d $src ]] || die "not a directory: $src"
	# the source must be outside every directory this run writes into
	local target
	for target in "$BASE_DIR" "$HS_ETC" "$HS_DATA" "$DERP_MAP_DIR" "$HP_DATA"; do
		case "$src" in
		"$target" | "$target"/*) die "the source must not be inside the target directory ($target)" ;;
		esac
		case "$target" in
		"$src" | "$src"/*) die "the target directory $target must not be inside the source ($src)" ;;
		esac
	done
	local found=0 f
	for f in db.sqlite noise_private.key config.yaml; do
		[[ -e "$src/$f" ]] && found=1
	done
	((found == 1)) || die "$src does not look like a Headscale data directory (no db.sqlite, noise_private.key or config.yaml)"
	MIGRATE_SRC="$src"
	MIGRATE_ACTIVE=1
	say ""
	say "The originals in $src are only ever READ: nothing is deleted, moved or modified there."
	local entry
	for entry in db.sqlite noise_private.key derp_server_private.key config.yaml policy.hujson extra-records.json derp-maps; do
		if [[ -e "$src/$entry" ]]; then
			say "  found: $src/$entry"
		fi
	done
	say "Not copied (check by hand if you need them):"
	local n=0
	for entry in "$src"/*; do
		[[ -e $entry ]] || continue
		case "$(basename "$entry")" in
		db.sqlite | noise_private.key | derp_server_private.key | config.yaml | policy.hujson | extra-records.json | derp-maps) ;;
		*)
			say "  - $entry"
			n=$((n + 1))
			;;
		esac
	done
	((n == 0)) && dim "  (nothing else in that directory)"
	return 0
}

plan_migration() {
	local ts="$1" archive
	archive="$BACKUP_DIR/headscale-pre-migration-$ts.tar.gz"
	emit "  backup: tar -czf $archive -C $(dirname "$MIGRATE_SRC") $(basename "$MIGRATE_SRC") (mode 600)"
	emit "  copy (originals are never touched):"
	emit "    $MIGRATE_SRC/config.yaml       -> $HS_ETC/config.yaml"
	emit "    $MIGRATE_SRC/db.sqlite         -> $HS_DATA/db.sqlite"
	emit "    $MIGRATE_SRC/noise_private.key -> $HS_DATA/noise_private.key"
	[[ -e "$MIGRATE_SRC/derp_server_private.key" ]] && emit "    $MIGRATE_SRC/derp_server_private.key -> $HS_DATA/derp_server_private.key"
	[[ -e "$MIGRATE_SRC/policy.hujson" ]] && emit "    $MIGRATE_SRC/policy.hujson     -> $HS_ETC/policy.hujson"
	[[ -e "$MIGRATE_SRC/extra-records.json" ]] && emit "    $MIGRATE_SRC/extra-records.json -> $HS_ETC/extra-records.json"
	[[ -d "$MIGRATE_SRC/derp-maps" ]] && emit "    $MIGRATE_SRC/derp-maps/*       -> $HS_ETC/derp-maps/"
	return 0
}

run_migration() {
	local ts="$1" archive
	archive="$BACKUP_DIR/headscale-pre-migration-$ts.tar.gz"
	emit ""
	emit "--- migration from $MIGRATE_SRC ---"
	if ((DRY_RUN)); then
		plan_migration "$ts"
		return 0
	fi
	if have tar; then
		# the archive holds the database and the private keys, so create it
		# owner-only instead of trusting the umask of whoever runs the script
		if (umask 077 && tar -czf "$archive" -C "$(dirname "$MIGRATE_SRC")" "$(basename "$MIGRATE_SRC")"); then
			chmod 0600 "$archive" 2>/dev/null || warn "  could not restrict permissions on $archive, which holds the private keys"
			BACKUP_FILES+=("$archive")
			ok "  backup written: $archive ($(wc -c <"$archive" | tr -d ' ') bytes)"
			if have sha256sum; then
				dim "  sha256: $(sha256sum "$archive" | awk '{print $1}')"
			fi
		else
			die "the backup failed; nothing was copied (your original data is untouched)"
		fi
	else
		die "tar is missing; refusing to migrate without a backup (your original data is untouched)"
	fi
	act_copy "$MIGRATE_SRC/config.yaml" "$HS_ETC/config.yaml" "600" "Headscale config"
	act_copy "$MIGRATE_SRC/db.sqlite" "$HS_DATA/db.sqlite" "600" "database"
	act_copy "$MIGRATE_SRC/noise_private.key" "$HS_DATA/noise_private.key" "600" "noise private key"
	act_copy "$MIGRATE_SRC/derp_server_private.key" "$HS_DATA/derp_server_private.key" "600" "DERP private key"
	act_copy "$MIGRATE_SRC/policy.hujson" "$HS_ETC/policy.hujson" "600" "policy file"
	act_copy "$MIGRATE_SRC/extra-records.json" "$HS_ETC/extra-records.json" "644" "DNS records"
	if [[ -d "$MIGRATE_SRC/derp-maps" ]]; then
		if ((DRY_RUN)); then
			emit "  [dry-run] cp -a $MIGRATE_SRC/derp-maps/. $HS_ETC/derp-maps/"
		else
			mkdir -p "$HS_ETC/derp-maps"
			cp -a "$MIGRATE_SRC/derp-maps/." "$HS_ETC/derp-maps/"
			COPIED_FILES+=("$MIGRATE_SRC/derp-maps/* -> $HS_ETC/derp-maps/")
			ok "  copied: $MIGRATE_SRC/derp-maps/* -> $HS_ETC/derp-maps/"
		fi
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Configuration generation
# -----------------------------------------------------------------------------
hs_config_skeleton() {
	cat <<EOF
# Headscale configuration
# Generated by $SCRIPT_NAME v$SCRIPT_VERSION on $RUN_TS
# Deployment shape: docs/install/dual-image.md (Headscale and HeadplaneCN in
# separate containers, host networking, shared directories at identical
# absolute paths).
#
# MOST IMPORTANT: server_url is the address your clients registered against.
# Keep it byte-for-byte identical - changing it forces every node to log in
# again.

server_url: "$SERVER_URL"

# Listen address inside the container. With host networking this is $DEFAULT_HS_PORT on the NAS.
listen_addr: "0.0.0.0:$DEFAULT_HS_PORT"
metrics_listen_addr: "$METRICS_ADDR"

# Keys, database and DERP key all live under $HS_DATA_CTR
# (the host directory $HS_DATA).
noise_private_key_path: "$HS_DATA_CTR/noise_private.key"

database:
  type: sqlite
  sqlite:
    path: "$HS_DATA_CTR/db.sqlite"

# Embedded DERP relay: STUN is announced on udp/$STUN_PORT and must be opened
# directly on the router/firewall - an HTTP reverse proxy cannot forward UDP.
derp:
  server:
    enabled: true
    region_id: $REGION_ID
    region_code: "$REGION_CODE"
    region_name: "$REGION_NAME"
    stun_listen_addr: "0.0.0.0:$STUN_PORT"
    private_key_path: "$HS_DATA_CTR/derp_server_private.key"
  # These are container paths: Headscale runs in a container too and both
  # containers mount this directory at the same absolute path.
  paths:
    - $DERP_MAP_CTR
EOF
}

hp_config_skeleton() {
	local api_line agent_enabled
	if [[ -n $API_KEY ]]; then
		api_line="  api_key: \"$API_KEY\""
		agent_enabled="true"
	else
		api_line="  # REQUIRED for login, the configuration check and the agent. Create one with:
  #   docker compose exec headscale headscale apikeys create
  # api_key: \"hskey-api-...\""
		agent_enabled="false"
	fi
	local cookie_secure="true"
	[[ $BASE_URL == https://* ]] || cookie_secure="false"
	cat <<EOF
# HeadplaneCN configuration
# Generated by $SCRIPT_NAME v$SCRIPT_VERSION on $RUN_TS
# Deployment shape: docs/install/dual-image.md
#
# Keep this file readable only by root: it contains the cookie secret and the
# Headscale API key.

server:
  host: "${HP_LISTEN_ADDR:-0.0.0.0}"
  port: $HP_PORT

  # The URL the browser uses: scheme + hostname + port, WITHOUT the /admin
  # suffix (the dashboard lives at <base_url>/admin).
  base_url: "$BASE_URL"

  # Exactly 32 characters. Rotating it logs everybody out.
  cookie_secret: "$COOKIE_SECRET"

  # The browser reaches the UI over $([[ $BASE_URL == https://* ]] && echo HTTPS || echo plain HTTP)
  cookie_secure: $cookie_secure

  data_path: "$HP_DATA_CTR"

headscale:
  # With host networking, 127.0.0.1 inside the container is the NAS itself,
  # which is where the Headscale container listens.
  url: "$([[ $HOST_NETWORK == 1 ]] && echo "http://127.0.0.1:$DEFAULT_HS_PORT" || echo "http://headscale:$DEFAULT_HS_PORT")"

  # Public address shown in the UI and used for browser SSH.
  public_url: "$SERVER_URL"

  # REQUIRED: the path of Headscale's effective configuration inside this
  # container, identical to the mount point.
  config_path: "$HS_CONFIG_CTR"

$api_line

integration:
  # Sends SIGHUP to headscale serve after a config save; needs pid: host.
  proc:
    enabled: true

  # Syncs node versions, OS details and DERP regions/latency.
  agent:
    enabled: $agent_enabled
EOF
}

build_compose_content() {
	local c="" netmode ports_hs="" ports_hp="" deploy_mode_note admin_publish=""
	[[ $ADMIN_BIND == "127.0.0.1" ]] && admin_publish="127.0.0.1:"
	if ((HOST_NETWORK == 1)); then
		netmode="    network_mode: \"host\""
		deploy_mode_note="    # host networking: no ports: section - the container binds the NAS ports directly"
	else
		netmode=""
		ports_hs="    ports:
      - \"$DEFAULT_HS_PORT:$DEFAULT_HS_PORT\"
      - \"127.0.0.1:$DEFAULT_METRICS_PORT:$DEFAULT_METRICS_PORT\"
      - \"$STUN_PORT:$STUN_PORT/udp\""
		ports_hp="    ports:
      - \"$admin_publish$HP_PORT:$HP_PORT\""
		deploy_mode_note="    # bridge networking: published ports below; HeadplaneCN reaches Headscale as http://headscale:$DEFAULT_HS_PORT"
	fi
	c+="# docker-compose.yml"$'\n'
	c+="# Generated by $SCRIPT_NAME v$SCRIPT_VERSION on $RUN_TS"$'\n'
	c+="# Deployment shape: docs/install/dual-image.md"$'\n'
	c+="#"$'\n'
	c+="# Host path -> container path, built from the answers given to the prompts."$'\n'
	c+="# Both services mount the same host paths at identical container paths."$'\n'
	c+="#   $HS_ETC -> $HS_ETC_CTR"$'\n'
	c+="#   $DERP_MAP_DIR -> $DERP_DIR_CTR"$'\n'
	c+="#   $HS_DATA -> $HS_DATA_CTR"$'\n'
	c+="#   $HP_CONFIG -> $HP_CONFIG_CTR"$'\n'
	c+="#   $HP_DATA -> $HP_DATA_CTR"$'\n'
	c+="#"$'\n'
	c+="# The pinned tags below are the version lock. To upgrade:"$'\n'
	c+="#   edit the tag(s), then: docker compose pull && docker compose up -d"$'\n'
	c+=$'\n'
	c+="services:"$'\n'
	c+="  headscale:"$'\n'
	c+="    image: \"$HS_IMAGE\""$'\n'
	c+="    container_name: \"headscale\""$'\n'
	c+="    restart: \"unless-stopped\""$'\n'
	c+="    command: \"serve\""$'\n'
	[[ -n $netmode ]] && c+="$netmode"$'\n'
	c+="    # No pid: \"host\" here: the SIGHUP integration runs inside the headplane container,"$'\n'
	c+="    # which shares the host PID namespace and sees this process anyway."$'\n'
	[[ -n $ports_hs ]] && c+="$ports_hs"$'\n'
	c+="    volumes:"$'\n'
	c+="      # Config directory: config.yaml, policy and the DERP maps below $DERP_MAP_DIR"$'\n'
	c+="      # $HS_ETC is mounted rw here and rw in headplane too, at the same container path"$'\n'
	c+="      - \"$HS_ETC:$HS_ETC_CTR\""$'\n'
	c+="      # Database, noise key and DERP key"$'\n'
	c+="      - \"$HS_DATA:$HS_DATA_CTR\""$'\n'
	c+="    environment:"$'\n'
	c+="      - \"TZ=$TZONE\""$'\n'
	c+="    logging:"$'\n'
	c+="      driver: \"json-file\""$'\n'
	c+="      options:"$'\n'
	c+="        max-size: \"10m\""$'\n'
	c+="        max-file: \"3\""$'\n'
	c+="    # No healthcheck: the headscale image ships neither HEALTHCHECK nor an HTTP client."$'\n'
	c+="    # The installer verifies /health after startup instead."$'\n'
	c+="$deploy_mode_note"$'\n'
	c+=$'\n'
	c+="  headplane:"$'\n'
	c+="    image: \"$HP_IMAGE\""$'\n'
	c+="    container_name: \"headplane\""$'\n'
	c+="    restart: \"unless-stopped\""$'\n'
	c+="    depends_on:"$'\n'
	c+="      - \"headscale\""$'\n'
	[[ -n $netmode ]] && c+="$netmode"$'\n'
	c+="    # REQUIRED for integration.proc (find headscale serve in /proc and signal it)"$'\n'
	c+="    pid: \"host\""$'\n'
	[[ -n $ports_hp ]] && c+="$ports_hp"$'\n'
	c+="    volumes:"$'\n'
	c+="      # HeadplaneCN's own configuration file (read-only is enough): $HP_CONFIG"$'\n'
	c+="      - \"$HP_CONFIG:$HP_CONFIG_CTR:ro\""$'\n'
	c+="      # Sessions, internal database, config snapshots, agent state: $HP_DATA"$'\n'
	c+="      - \"$HP_DATA:$HP_DATA_CTR\""$'\n'
	c+="      # The chosen config directory again: the SAME absolute path as in the headscale container"$'\n'
	c+="      - \"$HS_ETC:$HS_ETC_CTR\""$'\n'
	c+="      # The chosen data directory, same absolute path, read-only on purpose (path checks and snapshots)"$'\n'
	c+="      - \"$HS_DATA:$HS_DATA_CTR:ro\""$'\n'
	c+="    environment:"$'\n'
	c+="      - \"TZ=$TZONE\""$'\n'
	c+="    logging:"$'\n'
	c+="      driver: \"json-file\""$'\n'
	c+="      options:"$'\n'
	c+="        max-size: \"10m\""$'\n'
	c+="        max-file: \"3\""$'\n'
	c+="    # No healthcheck block: the image already defines one (HEALTHCHECK CMD /bin/hp_healthcheck)."$'\n'
	printf '%s' "$c"
	return 0
}

# -----------------------------------------------------------------------------
# Config writers
# -----------------------------------------------------------------------------
write_headscale_config() {
	local ts="$1" src="" spec="" log="" out="" newfile="" line kind key old new note changed=0
	if [[ -f $HS_ETC/config.yaml ]]; then
		src="$HS_ETC/config.yaml"
	elif ((DRY_RUN)) && [[ -n $MIGRATE_SRC && -f $MIGRATE_SRC/config.yaml ]]; then
		src="$MIGRATE_SRC/config.yaml"
		dim "  [dry-run] reading the config that would be copied from $MIGRATE_SRC"
	fi

	if [[ -z $src ]]; then
		emit ""
		if ((DRY_RUN)); then
			emit "--- would write: $HS_ETC/config.yaml (new skeleton) ---"
			hs_config_skeleton | mask_config_lines
			emit "--- end: $HS_ETC/config.yaml ---"
		else
			emit "--- new file: $HS_ETC/config.yaml ---"
			# process substitution, not a pipe: stage_file must stay in this
			# shell so it can record the file in WRITTEN_FILES
			stage_file "$HS_ETC/config.yaml" 600 < <(hs_config_skeleton)
		fi
		emit "  derp.paths entry: $DERP_MAP_CTR"
		return 0
	fi

	local dbtype
	dbtype="$(yaml_get "$src" "database.type" 2>/dev/null || true)"
	if [[ -n $dbtype && $dbtype != "sqlite" ]]; then
		die "$src uses database.type: $dbtype; this installer only supports sqlite (refusing to rewrite your config)"
	fi

	spec="$(new_tmp_file)"
	log="$(new_tmp_file)"
	{
		printf 'server_url\tstr\t%s\n' "$SERVER_URL"
		printf 'listen_addr\tstr\t0.0.0.0:%s\n' "$DEFAULT_HS_PORT"
		printf 'metrics_listen_addr\tstr\t%s\n' "$METRICS_ADDR"
		printf 'noise_private_key_path\tstr\t%s/noise_private.key\n' "$HS_DATA_CTR"
		printf 'database.type\tstr\tsqlite\n'
		printf 'database.sqlite.path\tstr\t%s/db.sqlite\n' "$HS_DATA_CTR"
		printf 'derp.server.enabled\traw\ttrue\n'
		printf 'derp.server.region_id\traw\t%s\n' "$REGION_ID"
		printf 'derp.server.region_code\tstr\t%s\n' "$REGION_CODE"
		printf 'derp.server.region_name\tstr\t%s\n' "$REGION_NAME"
		printf 'derp.server.stun_listen_addr\tstr\t0.0.0.0:%s\n' "$STUN_PORT"
		printf 'derp.server.private_key_path\tstr\t%s/derp_server_private.key\n' "$HS_DATA_CTR"
		printf 'derp.paths\tlist\t%s\n' "$DERP_MAP_CTR"
	} >"$spec"

	if ((DRY_RUN)); then
		out="$(new_tmp_file)"
		patch_config "$src" "$spec" "$log" >"$out"
		emit ""
		emit "--- would patch: $HS_ETC/config.yaml (from $src; original kept as .bak) ---"
		mask_config_lines <"$out"
		emit "--- end: $HS_ETC/config.yaml ---"
		emit "changes that would be made:"
		print_change_log "$log"
		verify_derp_paths "$out" plan
		return 0
	fi

	# real run: keep a .bak next to the file, then patch
	local bak="$HS_ETC/config.yaml.bak"
	if [[ ! -e $bak ]]; then
		cp -a "$src" "$bak"
		chmod 600 "$bak" 2>/dev/null || true
		BACKUP_FILES+=("$bak")
		ok "  original kept: $bak"
	else
		local stamped="$HS_ETC/config.yaml.bak-$ts"
		cp -a "$src" "$stamped"
		chmod 600 "$stamped" 2>/dev/null || true
		BACKUP_FILES+=("$stamped")
		dim "  $bak already existed; this run also kept $stamped"
	fi
	newfile="$(new_tmp_file)"
	patch_config "$src" "$spec" "$log" >"$newfile"
	if cmp -s "$src" "$newfile"; then
		dim "  $HS_ETC/config.yaml already matches the required values (no change)"
		emit "  no change needed: $HS_ETC/config.yaml"
	else
		stage_file "$HS_ETC/config.yaml" 600 <"$newfile"
		chmod 600 "$HS_ETC/config.yaml" 2>/dev/null || true
	fi
	emit "  changes applied to $HS_ETC/config.yaml:"
	print_change_log "$log"
	verify_derp_paths "$HS_ETC/config.yaml" real
	if have diff; then
		local d
		d="$(diff -u "$bak" "$HS_ETC/config.yaml" 2>/dev/null || true)"
		if [[ -n $d ]]; then
			emit "  unified diff (secrets masked):"
			printf '%s\n' "$d" | mask_config_lines | sed 's/^/    /'
		fi
	fi
	return 0
}

write_headplane_config() {
	local ts="$1" src="" spec="" log="" out="" newfile=""
	if [[ -f $HP_CONFIG ]]; then
		src="$HP_CONFIG"
	fi
	if [[ -z $src ]]; then
		if ((DRY_RUN)); then
			emit ""
			emit "--- would write: $HP_CONFIG (new file) ---"
			hp_config_skeleton | mask_config_lines
			emit "--- end: $HP_CONFIG ---"
		else
			stage_file "$HP_CONFIG" 600 < <(hp_config_skeleton)
		fi
		return 0
	fi

	spec="$(new_tmp_file)"
	log="$(new_tmp_file)"
	{
		printf 'server.host\tstr\t%s\n' "${HP_LISTEN_ADDR:-0.0.0.0}"
		printf 'server.port\traw\t%s\n' "$HP_PORT"
		printf 'server.base_url\tstr\t%s\n' "$BASE_URL"
		printf 'server.cookie_secure\traw\t%s\n' "$([[ $BASE_URL == https://* ]] && echo true || echo false)"
		printf 'server.data_path\tstr\t%s\n' "$HP_DATA_CTR"
		((KEEP_COOKIE == 0)) && printf 'server.cookie_secret\tstr\t%s\n' "$COOKIE_SECRET"
		printf 'headscale.url\tstr\t%s\n' "$([[ $HOST_NETWORK == 1 ]] && echo "http://127.0.0.1:$DEFAULT_HS_PORT" || echo "http://headscale:$DEFAULT_HS_PORT")"
		printf 'headscale.public_url\tstr\t%s\n' "$SERVER_URL"
		printf 'headscale.config_path\tstr\t%s\n' "$HS_CONFIG_CTR"
		[[ -n $API_KEY ]] && printf 'headscale.api_key\tstr\t%s\n' "$API_KEY"
		printf 'integration.proc.enabled\traw\ttrue\n'
		printf 'integration.agent.enabled\traw\t%s\n' "$([[ -n $API_KEY ]] && echo true || echo false)"
	} >"$spec"

	if ((DRY_RUN)); then
		out="$(new_tmp_file)"
		patch_config "$src" "$spec" "$log" >"$out"
		emit ""
		emit "--- would patch: $HP_CONFIG (original kept as $HP_CONFIG.bak-$ts) ---"
		mask_config_lines <"$out"
		emit "--- end: $HP_CONFIG ---"
		emit "changes that would be made:"
		print_change_log "$log"
		return 0
	fi

	local bak="$HP_CONFIG.bak-$ts"
	cp -a "$src" "$bak"
	chmod 600 "$bak" 2>/dev/null || true
	BACKUP_FILES+=("$bak")
	ok "  backed up: $HP_CONFIG -> $bak"
	newfile="$(new_tmp_file)"
	patch_config "$src" "$spec" "$log" >"$newfile"
	if cmp -s "$src" "$newfile"; then
		dim "  $HP_CONFIG already matches the required values (no change)"
	else
		stage_file "$HP_CONFIG" 600 <"$newfile"
	fi
	emit "  changes applied to $HP_CONFIG:"
	print_change_log "$log"
	return 0
}

print_change_log() {
	local log="$1" kind key old new note n=0
	[[ -s $log ]] || {
		dim "  (no changes)"
		return 0
	}
	while IFS=$'\t' read -r kind key old new note; do
		[[ -n ${kind:-} ]] || continue
		n=$((n + 1))
		if is_secret_key "$key"; then
			old="$(mask_secret "$old")"
			new="$(mask_secret "$new")"
		fi
		case "$kind" in
		CHANGE) emit "    ~ $key: $old  ->  $new" ;;
		ADD) emit "    + $key: $new" ;;
		MANUAL) emit "    ! $key: $note" ;;
		NOTE) emit "    * $key: $note" ;;
		DROP) emit "    - $key: $old ($note)" ;;
		*) emit "    $kind $key $old $new $note" ;;
		esac
	done <"$log"
	((n == 0)) && dim "  (no changes)"
	return 0
}

# -----------------------------------------------------------------------------
# Plan / summary
# -----------------------------------------------------------------------------
# The resolved layout: printed once per run (dry run and real run alike), before
# anything is written, and reused verbatim for the volumes: entries.
print_layout() {
	emit "resolved layout (host path -> container path, identical in both services):"
	emit "  Headscale config dir   : $HS_ETC"
	emit "    -> $HS_ETC_CTR   (rw in both; holds config.yaml, policy.hujson)"
	emit "  DERP map directory     : $DERP_MAP_DIR"
	emit "    -> $DERP_DIR_CTR   (rw in both; holds $DEFAULT_DERP_MAP_NAME)"
	emit "  Headscale data dir     : $HS_DATA"
	emit "    -> $HS_DATA_CTR   (rw in headscale, ro in headplane)"
	emit "  HeadplaneCN config file: $HP_CONFIG"
	emit "    -> $HP_CONFIG_CTR   (ro)"
	emit "  HeadplaneCN data dir   : $HP_DATA"
	emit "    -> $HP_DATA_CTR   (rw)"
	emit "  DERP mirror map file   : $DERP_MAP_HOST  (created only if missing)"
	emit "  compose file           : $COMPOSE_FILE"
	emit "  backups                : $BACKUP_DIR"
	if ((LAYOUT_COLLISION)); then
		emit "  NOTE: two of the paths above are the same - see the warnings printed at the prompts"
	fi
	return 0
}

print_plan() {
	emit ""
	emit "==============================================================================="
	if ((DRY_RUN)); then
		emit " PLAN (dry run) - nothing below is executed"
	else
		emit " PLAN - the following will be written"
	fi
	emit "==============================================================================="
	emit "base directory : $BASE_DIR"
	print_layout
	emit "images         : headscale=$HS_IMAGE"
	emit "                 headplane=$HP_IMAGE"
	emit "networking     : $([[ $HOST_NETWORK == 1 ]] && echo "host (no ports: section)" || echo "bridge (published ports)")"
	emit "timezone       : $TZONE"
	emit "listen ports   : headscale tcp/$DEFAULT_HS_PORT, metrics $METRICS_ADDR, stun udp/$STUN_PORT, headplane tcp/$HP_PORT"
	emit "client URL     : $SERVER_URL"
	emit "DERP endpoint  : $DERP_URL"
	emit "admin UI       : $ADMIN_URL/admin  (server.base_url=$BASE_URL)"
	emit "admin exposure : $(if [[ $ADMIN_BIND == "127.0.0.1" ]]; then printf 'reachable on 127.0.0.1:%s only' "$HP_PORT"; elif ((HOST_NETWORK == 1)); then printf 'reachable on every interface (server.host=%s)' "$ADMIN_BIND"; else printf 'published on every interface; firewall tcp/%s or put a TLS reverse proxy in front' "$HP_PORT"; fi)"
	emit "API key        : $API_KEY_STATE"
	emit "cookie secret  : $COOKIE_STATE"
	emit ""
	emit "directories:"
	emit "  mkdir -p $(dirname "$HP_CONFIG") $HP_DATA $HS_ETC $DERP_MAP_DIR $HS_DATA $BACKUP_DIR"
	emit "files:"
	if ((MIGRATE_ACTIVE)); then
		emit "  migration:"
		plan_migration "$RUN_STAMP"
	fi
	emit "  docker-compose.yml:"
	build_compose_content | sed 's/^/    /'
	emit ""
	emit "  $HP_CONFIG (HeadplaneCN config, mode 600)"
	emit "  $HS_ETC/config.yaml (Headscale config, mode 600, original kept as .bak)"
	emit "  $DERP_MAP_HOST (placeholder 'regions: {}' only if missing)"
	emit ""
	emit "permissions:"
	emit "  chmod 600 $HP_CONFIG $HS_ETC/config.yaml $HS_DATA/noise_private.key $HS_DATA/derp_server_private.key"
	emit "  chmod 700 $HP_DATA $HS_DATA"
	emit "  chmod 755 $HS_ETC $DERP_MAP_DIR (only for directories this run creates)"
	emit "  chown -R 0:0 $HS_ETC $HS_DATA (real run as root)"
	emit ""
	emit "commands the operator will run afterwards:"
	emit "  cd $BASE_DIR"
	emit "  docker compose pull"
	emit "  docker compose up -d"
	emit "  docker compose ps"
	emit "  docker compose logs headscale | tail -n 30"
	emit "  docker compose exec headscale headscale version"
	if ((HAVE_CURL)); then
		emit "  curl -s http://127.0.0.1:$DEFAULT_HS_PORT/health    # expect {\"status\":\"pass\"}"
	fi
	emit "==============================================================================="
	return 0
}

print_summary() {
	local start_cmd upgrade_cmd
	start_cmd="cd $BASE_DIR && docker compose up -d"
	upgrade_cmd="edit the tags in $COMPOSE_FILE, then: docker compose pull && docker compose up -d"
	emit ""
	emit "==============================================================================="
	emit " SUMMARY (safe to copy)"
	emit "==============================================================================="
	emit "base directory      : $BASE_DIR"
	emit "compose file        : $COMPOSE_FILE"
	emit "HeadplaneCN config  : $HP_CONFIG"
	emit "HeadplaneCN data    : $HP_DATA"
	emit "Headscale config    : $HS_ETC/config.yaml"
	emit "Headscale data      : $HS_DATA"
	emit "DERP map directory  : $DERP_MAP_DIR  ($DERP_MAP_HOST)"
	emit "images              : $HS_IMAGE"
	emit "                      $HP_IMAGE"
	emit "API key             : $API_KEY_STATE"
	emit "client URL          : $SERVER_URL"
	emit "DERP endpoint       : $DERP_URL"
	emit "admin UI            : $ADMIN_URL/admin"
	emit "STUN                : udp/$STUN_PORT must be reachable directly (no HTTP proxy can forward UDP)"
	emit ""
	emit "open in the browser : $ADMIN_URL/admin"
	emit "                      http://127.0.0.1:$DEFAULT_HS_PORT/health  (expect {\"status\":\"pass\"})"
	emit "                      http://127.0.0.1:$DEFAULT_HS_PORT/derp    (expect 400/426, not 404)"
	emit ""
	emit "start               : $start_cmd"
	emit "upgrade             : $upgrade_cmd"
	emit "rollback (headplane): set the old tag back and run: docker compose up -d"
	emit "rollback (headscale): docker compose down, restore the pre-upgrade backup over"
	emit "                      $HS_DATA/db.sqlite, set the old tag back, docker compose up -d"
	emit "backup before any Headscale upgrade:"
	emit "  docker compose stop headscale"
	emit "  tar -czf $BACKUP_DIR/pre-upgrade-\$(date +%F).tar.gz -C $(dirname "$BASE_DIR") $(basename "$BASE_DIR")"
	emit "  docker compose start headscale"
	emit ""
	emit "!! Headscale database migrations are ONE-WAY: always take the backup above first."
	emit ""
	emit "reverse proxy requirements (Lucky or equivalent):"
	emit "  * client traffic: HTTP/2 end to end, buffering and gzip rewriting OFF, timeouts >= 300s,"
	emit "    and do not rewrite /key /ts2021 /api/v1/* /health /verify"
	emit "  * /derp: keep the Upgrade/WebSocket headers, no buffering, timeouts >= 300s. The"
	emit "    server_url hostname itself must serve /derp; a derp. hostname is only a second entrance"
	emit "  * STUN: open udp/$STUN_PORT straight to this machine on the router/firewall"
	emit "  * certificates must be trusted by the clients and match the server_url hostname"
	if [[ -n ${API_KEY_NEEDED_HINT:-} ]]; then
		emit ""
		emit "TODO: create an API key and put it into headscale.api_key in $HP_CONFIG:"
		emit "  docker compose exec headscale headscale apikeys create"
	fi
	if ((${#BACKUP_FILES[@]} > 0)); then
		emit ""
		emit "backups created by this run:"
		local b
		for b in "${BACKUP_FILES[@]}"; do emit "  $b"; done
	fi
	if ((${#WRITTEN_FILES[@]} > 0)); then
		emit ""
		emit "files $([[ $DRY_RUN == 1 ]] && echo "that would be written" || echo "written by this run"):"
		local x
		for x in "${WRITTEN_FILES[@]}"; do emit "  $x"; done
	fi
	if ((${#COPIED_FILES[@]} > 0)); then
		emit ""
		emit "copies $([[ $DRY_RUN == 1 ]] && echo "that would be made" || echo "made by this run"):"
		local y
		for y in "${COPIED_FILES[@]}"; do emit "  $y"; done
	fi
	emit "==============================================================================="
	return 0
}

run_verification() {
	local i ok_health=0
	emit ""
	emit "--- verification ---"
	say "waiting a few seconds for the containers to come up..."
	for i in 1 2 3 4 5 6; do
		if have curl && curl -fsS --max-time 2 "http://127.0.0.1:$DEFAULT_HS_PORT/health" 2>/dev/null | grep -q '"status"'; then
			ok_health=1
			break
		fi
		sleep 2
	done
	emit ""
	emit "\$ docker compose ps"
	(cd "$BASE_DIR" && docker compose ps) 2>&1 || warn "docker compose ps failed"
	emit ""
	emit "\$ docker compose logs --tail=30 headscale"
	(cd "$BASE_DIR" && docker compose logs --tail=30 headscale) 2>&1 | sed 's/^/  /' || warn "docker compose logs failed"
	emit ""
	emit "\$ docker compose exec -T headscale headscale version"
	if (cd "$BASE_DIR" && docker compose exec -T headscale headscale version) 2>&1 | sed 's/^/  /'; then
		:
	else
		warn "the image has no 'headscale' CLI on PATH; use 'docker compose logs headscale' instead"
	fi
	emit ""
	emit "\$ docker compose logs --tail=40 headplane | grep -iE 'valid Headscale configuration|Found headscale serve|Agent'"
	(cd "$BASE_DIR" && docker compose logs --tail=40 headplane 2>&1 | grep -iE 'valid Headscale configuration|Found headscale serve|Agent') || warn "no matching HeadplaneCN log line yet"
	if ((ok_health == 1)); then
		ok "headscale /health answered with a status - the control server is up"
	else
		warn "http://127.0.0.1:$DEFAULT_HS_PORT/health did not answer yet; check the logs above"
	fi
	return 0
}

# -----------------------------------------------------------------------------
# Help / self test
# -----------------------------------------------------------------------------
usage() {
	cat <<'EOF'
dual-image-install.sh - interactive installer for the two-container
Headscale + HeadplaneCN deployment (docs/install/dual-image.md).

USAGE
  bash scripts/dual-image-install.sh [options]

  Prompts and progress are written to stderr; the plan, the verification
  output and the final summary are written to stdout.

FLAGS
  -h, --help              show this help and exit
  -n, --dry-run           print everything that would be written, copied and
                          run, then exit without changing anything outside a
                          private temporary directory (removed on exit)
      --self-test         run the input validators, the YAML reader and the
                          config patcher against fixtures and exit
      --defaults          answer every prompt with its default value (never
                          starts the stack; combine with --dry-run for a
                          non-interactive plan)
      --base-dir PATH     answer the base directory prompt
      --headscale-tag IMG answer the Headscale image prompt (repo:tag)
      --headplane-tag IMG answer the HeadplaneCN image prompt (repo:tag)
      --server-url URL    answer the client server_url prompt
      --derp-host H[:P]   answer the embedded DERP prompt (or "none")
      --admin-host H[:P]  answer the admin UI prompt (or "none")
      --admin-port PORT   answer the HeadplaneCN listen port prompt
      --admin-bind ADDR   admin UI exposure: 0.0.0.0 (all interfaces, default)
                          or 127.0.0.1 (local only, behind a reverse proxy)
      --stun-port PORT    answer the STUN udp port prompt
      --region-id N       answer the embedded DERP region id prompt
      --tz ZONE           answer the timezone prompt
      --version           print the installer version and exit

PROMPTS (default in brackets; every answer is validated, invalid answers are
re-asked instead of aborting)
  1  dry run?                                      [n]        (only without -n)
  2  base data directory                           [/vol1/1000/APP/headplane]
       must be an absolute path, writable, and you must confirm that it holds
       the database and the private keys
  3  HeadplaneCN config file                       [<base>/config.yaml]
       absolute file path; an existing file is patched, never replaced
  4  HeadplaneCN data directory                    [<base>/data]
  5  Headscale config directory                    [<base>/etc/headscale]
       holds config.yaml, policy.hujson and the DERP map directory
  6  Headscale data directory                      [<base>/data/headscale]
       holds db.sqlite and noise_private.key
  7  DERP map directory (inside the config dir)    [<headscale config dir>/
                                                    derp-maps]
       must be the Headscale config directory or a directory inside it, because
       that is the directory both containers mount
       3-7 must each be an absolute path that this script can create or write,
       and no two of the directories may be the same path (a collision is
       warned about, never accepted silently); all five are printed back as the
       resolved layout, and both services' volumes: entries are built from them
  8  you understand the base directory holds the database and keys? [y]
  9  Headscale image                              [headscale/headscale:0.29.2]
 10  HeadplaneCN image                     [ghcr.io/cgg888/headplanecn:0.22.13]
       repo:tag, non-empty tag, "latest" is refused
 11  client server_url                             [detected, else
                                                    https://ha.example.com:8443]
       http(s)://host[:port], no path. When migrating this MUST stay identical.
 12  embedded DERP host[:port]                     [none]
       "none" = the client hostname also serves /derp
 13  admin UI host[:port]                          [none]
       "none" = server.base_url is the client URL (UI at <base_url>/admin)
 14  use host networking for both containers?      [y]
       yes: no ports: section is written, containers bind NAS ports directly
       no : bridge mode, ports are published and Headscale is reached as
            http://headscale:8080
 15  HeadplaneCN listen port                       [4100 or existing value]
 16  STUN udp port                                 [3478]
 17  Headscale metrics listen address              [1 = 127.0.0.1:9090]
 18  timezone                                      [detected, else Asia/Shanghai]
 19  Headscale API key                             [2 = leave blank]
       1 = paste an existing key (hidden input), 2 = leave blank and print the
       command that creates one, 3 = read the key from a file
 20  cookie_secret                                 [generate a random one]
       if the existing config has one you are asked whether to keep it; a
       pasted value must be exactly 32 characters
 21  DERP region id / code / name                  [999 / headscale /
                                                    Headscale Embedded DERP]
       the mirror map file is always <chosen DERP dir>/official-mirror.yaml and
       its container path follows from the config directory mount
 22  migrate an existing Headscale data directory? [n]
       then: the source directory [/vol1/@appdata/headscale]. Only db.sqlite,
       noise_private.key, config.yaml, policy.hujson (plus derp_server_private
       .key, extra-records.json and derp-maps/ when present) are COPIED after a
       timestamped tar backup into the chosen directories; the originals are
       never deleted, moved or modified.
 23  start the stack now (docker compose up -d)?    [n]

WHAT IT WRITES
  <base>/docker-compose.yml                 both services, pinned tags,
                                            network_mode: host, pid: host,
                                            restart: unless-stopped, volumes
                                            derived from the chosen paths (both
                                            services mount the same host paths at
                                            identical container paths, Headscale
                                            data read-only in HeadplaneCN), a
                                            healthcheck only where the image
                                            provides one
  <chosen HeadplaneCN config file>          HeadplaneCN config (mode 600);
                                            existing file is patched, not
                                            replaced, and backed up
  <chosen Headscale config dir>/config.yaml Headscale config (mode 600);
                                            existing file is patched key by key
                                            with the original kept as .bak
  <chosen DERP dir>/official-mirror.yaml    placeholder map (regions: {}) if the
                                            file is missing, so Headscale can
                                            start
  <chosen directories>                      created if missing: 700 for the two
                                            data directories, 755 for the config
                                            and DERP directories
  <base>/backups/                           pre-migration tarball (real runs)

WHAT IT NEVER DOES
  * no git commands of any kind;
  * no "rm -rf" anywhere, and no deletion of user data;
  * no file is overwritten without a backup first (.bak or .bak-<timestamp>);
  * no container is started without an explicit confirmation.
EOF
}

self_test() {
	local fails=0 T
	T="$(new_tmp_dir)"

	check_ok() { # fn value label
		if "$1" "$2" >/dev/null 2>&1; then
			printf 'PASS  %s accepts %s\n' "$1" "$3"
		else
			printf 'FAIL  %s should accept %s\n' "$1" "$3"
			fails=$((fails + 1))
		fi
	}
	check_no() { # fn value label
		if "$1" "$2" >/dev/null 2>&1; then
			printf 'FAIL  %s should reject %s\n' "$1" "$3"
			fails=$((fails + 1))
		else
			printf 'PASS  %s rejects %s\n' "$1" "$3"
		fi
	}

	check_ok v_abs_path "/vol1/1000/APP/headplane" "an absolute path"
	check_ok v_abs_path "/vol1/1000/APP/My Headplane" "an absolute path with a space"
	check_no v_abs_path "vol1/headplane" "a relative path"
	check_no v_abs_path "/vol1/../etc" "a path with .."
	check_no v_abs_path "/" "the filesystem root"

	# host directory / file targets, probed below the writable temp directory so
	# the result does not depend on this machine's permissions
	: >"$T/a-fixture-file"
	check_ok v_host_dir "$T/a data dir" "a directory below a writable parent"
	check_ok v_host_dir "$T" "an existing directory"
	check_no v_host_dir "$T/a-fixture-file" "an existing file given as a directory"
	check_no v_host_dir "relative/dir" "a relative directory"
	check_ok v_host_file "$T/headplane.yaml" "a new file below a writable parent"
	check_ok v_host_file "$T/a-fixture-file" "an existing writable file"
	check_no v_host_file "$T" "a directory given as a file"

	# The prompts run before the "write these files now?" confirmation, so they
	# must not create anything on disk.  This guards the removal of the
	# `mkdir -p` + `mktemp` probe that step_base_dir used to run while it was
	# only asking where to deploy.
	if declare -f step_base_dir | grep -Eq '(^|[^a-z])(mkdir|mktemp|touch|stage_file)([^a-z]|$)'; then
		printf 'FAIL  the base-directory prompt must not write to disk before the plan is confirmed\n'
		fails=$((fails + 1))
	else
		printf 'PASS  the base-directory prompt writes nothing before the plan is confirmed\n'
	fi

	# the DERP map directory has to stay inside the chosen config directory
	local saved_etc="$HS_ETC"
	HS_ETC="$T/etc/headscale"
	check_ok v_derp_dir "$HS_ETC/derp-maps" "a DERP dir inside the config dir"
	check_ok v_derp_dir "$HS_ETC" "the config dir itself as the DERP dir"
	check_no v_derp_dir "$T/elsewhere" "a DERP dir outside the config dir"
	HS_ETC="$saved_etc"

	if [[ "$(derp_container_dir "$T/etc/headscale/derp-maps" "$T/etc/headscale" "/etc/headscale")" == "/etc/headscale/derp-maps" ]]; then
		printf 'PASS  derp_container_dir keeps the sub-directory position\n'
	else
		printf 'FAIL  derp_container_dir (got %s)\n' "$(derp_container_dir "$T/etc/headscale/derp-maps" "$T/etc/headscale" "/etc/headscale")"
		fails=$((fails + 1))
	fi
	if [[ "$(derp_container_dir "$T/etc/headscale" "$T/etc/headscale" "/etc/headscale")" == "/etc/headscale" ]]; then
		printf 'PASS  derp_container_dir handles the config dir itself\n'
	else
		printf 'FAIL  derp_container_dir for the config dir itself\n'
		fails=$((fails + 1))
	fi

	check_ok v_port "1" "port 1"
	check_ok v_port "65535" "port 65535"
	check_no v_port "0" "port 0"
	check_no v_port "65536" "port 65536"
	check_no v_port "80a" "a non-numeric port"

	check_ok v_image_ref "headscale/headscale:0.29.2" "a pinned headscale image"
	check_ok v_image_ref "ghcr.io/cgg888/headplanecn:0.22.13" "a pinned registry image"
	check_no v_image_ref "headscale/headscale" "an image without a tag"
	check_no v_image_ref "headscale/headscale:latest" "the latest tag"
	check_no v_image_ref ":0.29.2" "an empty repository"

	check_ok v_http_url "https://ha.example.com:8443" "an https URL with a port"
	check_ok v_http_url "http://10.0.0.5" "an http URL with an IP"
	check_no v_http_url "https://ha.example.com/admin" "a URL with a path"
	check_no v_http_url "ha.example.com:8443" "a URL without a scheme"
	check_no v_http_url "https://ha.example.com:99999" "a URL with an invalid port"

	check_ok v_hostname "derp.example.com" "a hostname"
	check_ok v_hostname "192.168.1.10" "an IPv4 address"
	check_no v_hostname "-bad.example.com" "a hostname starting with a hyphen"
	check_no v_hostname "ha..example.com" "a hostname with an empty label"
	check_no v_hostname "ha_example.com" "a hostname with an underscore"
	check_no v_hostname "ha.example.c" "a one character TLD"

	check_ok v_host_port_opt "none" "the value none"
	check_ok v_host_port_opt "derp.example.com:8443" "host:port"
	check_no v_host_port_opt "derp.example.com:0" "host:0"

	check_ok v_tz "Asia/Shanghai" "a zone name"
	check_ok v_tz "UTC" "UTC"
	check_no v_tz "Bad Zone" "a zone with a space"
	check_no v_tz "/etc/localtime" "a path"

	check_ok v_secret32 "0123456789abcdef0123456789abcdef" "a 32 character secret"
	check_no v_secret32 "too-short" "a short secret"

	check_ok v_region_id "999" "region id 999"
	check_no v_region_id "0" "region id 0"

	check_ok v_container_path "/etc/headscale/derp-maps/official-mirror.yaml" "a path under /etc/headscale"
	check_no v_container_path "/vol1/1000/APP/headscale/etc/x.yaml" "a host path"

	if [[ "$(norm_path "/a/b///")" == "/a/b" ]]; then
		printf 'PASS  norm_path strips trailing slashes\n'
	else
		printf 'FAIL  norm_path strips trailing slashes\n'
		fails=$((fails + 1))
	fi

	# ---- YAML reader ------------------------------------------------------
	local fx="$T/fixture.yaml"
	cat >"$fx" <<'YAML'
server:
  host: "0.0.0.0"
  port: 4100
headscale:
  url: "http://headscale:5000"   # inline comment
  api_key: "hskey-api-abc"
integration:
  proc:
    enabled: false
YAML
	local got
	got="$(yaml_get "$fx" "headscale.url")"
	[[ $got == "http://headscale:5000" ]] && printf 'PASS  yaml_get nested scalar\n' || {
		printf 'FAIL  yaml_get nested scalar (got %s)\n' "$got"
		fails=$((fails + 1))
	}
	got="$(yaml_get "$fx" "server.port")"
	[[ $got == "4100" ]] && printf 'PASS  yaml_get integer\n' || {
		printf 'FAIL  yaml_get integer (got %s)\n' "$got"
		fails=$((fails + 1))
	}
	got="$(yaml_get "$fx" "integration.proc.enabled")"
	[[ $got == "false" ]] && printf 'PASS  yaml_get deep scalar\n' || {
		printf 'FAIL  yaml_get deep scalar (got %s)\n' "$got"
		fails=$((fails + 1))
	}
	got="$(yaml_get "$fx" "does.not.exist")"
	[[ -z $got ]] && printf 'PASS  yaml_get missing key is empty\n' || {
		printf 'FAIL  yaml_get missing key (got %s)\n' "$got"
		fails=$((fails + 1))
	}

	# ---- config patcher ---------------------------------------------------
	local hs="$T/hs.yaml" spec="$T/spec" log="$T/log" out="$T/out.yaml"
	cat >"$hs" <<'YAML'
# keep this comment
server_url: https://old.example.com:8443
listen_addr: 127.0.0.1:8080
metrics_listen_addr: 0.0.0.0:9090
noise_private_key_path: /old/noise_private.key
database:
  type: sqlite
derp:
  server:
    enabled: false
  paths:
    - /vol1/@appdata/headscale/derp-maps/official-mirror.yaml
policy:
  mode: database
YAML
	{
		printf 'server_url\tstr\thttps://ha.example.com:8443\n'
		printf 'listen_addr\tstr\t0.0.0.0:8080\n'
		printf 'metrics_listen_addr\tstr\t127.0.0.1:9090\n'
		printf 'database.sqlite.path\tstr\t/var/lib/headscale/db.sqlite\n'
		printf 'derp.server.region_id\traw\t999\n'
		printf 'derp.paths\tlist\t/etc/headscale/derp-maps/official-mirror.yaml\n'
	} >"$spec"
	patch_config "$hs" "$spec" "$log" >"$out"

	[[ "$(yaml_get "$out" "server_url")" == "https://ha.example.com:8443" ]] &&
		printf 'PASS  patcher rewrites an existing scalar\n' || {
		printf 'FAIL  patcher rewrites an existing scalar\n'
		fails=$((fails + 1))
	}
	[[ "$(yaml_get "$out" "listen_addr")" == "0.0.0.0:8080" ]] &&
		printf 'PASS  patcher rewrites listen_addr\n' || {
		printf 'FAIL  patcher rewrites listen_addr\n'
		fails=$((fails + 1))
	}
	[[ "$(yaml_get "$out" "database.sqlite.path")" == "/var/lib/headscale/db.sqlite" ]] &&
		printf 'PASS  patcher inserts a missing nested key under an existing block\n' || {
		printf 'FAIL  patcher inserts a missing nested key (got %s)\n' "$(yaml_get "$out" "database.sqlite.path")"
		fails=$((fails + 1))
	}
	[[ "$(yaml_get "$out" "derp.server.region_id")" == "999" ]] &&
		printf 'PASS  patcher inserts a missing key into a nested block\n' || {
		printf 'FAIL  patcher inserts a missing key into a nested block\n'
		fails=$((fails + 1))
	}
	[[ "$(yaml_get "$out" "derp.server.enabled")" == "false" ]] &&
		printf 'PASS  patcher leaves untouched keys alone\n' || {
		printf 'FAIL  patcher leaves untouched keys alone\n'
		fails=$((fails + 1))
	}
	[[ "$(yaml_get "$out" "policy.mode")" == "database" ]] &&
		printf 'PASS  patcher preserves unrelated blocks\n' || {
		printf 'FAIL  patcher preserves unrelated blocks\n'
		fails=$((fails + 1))
	}
	if [[ "$(grep -c '^    - /etc/headscale/derp-maps/official-mirror.yaml$' "$out" || true)" == "1" ]] &&
		! grep -q '/vol1/@appdata/headscale/derp-maps' "$out"; then
		printf 'PASS  patcher rewrites a stale host path to the mounted container path\n'
	else
		printf 'FAIL  patcher left a derp.paths entry the container cannot read\n'
		sed 's/^/      | /' "$out"
		fails=$((fails + 1))
	fi
	if grep -q 'keep this comment' "$out"; then
		printf 'PASS  patcher keeps comments\n'
	else
		printf 'FAIL  patcher lost a comment\n'
		fails=$((fails + 1))
	fi
	if awk -F'\t' '$1 == "CHANGE" && $2 == "derp.paths" && $3 ~ /^\/vol1\// && $4 == "/etc/headscale/derp-maps/official-mirror.yaml" { found = 1 } END { exit !found }' "$log" &&
		! grep -q 'old host path is still listed' "$log"; then
		printf 'PASS  the change log records the rewrite instead of only a note\n'
	else
		printf 'FAIL  the change log does not record the derp.paths rewrite\n'
		sed 's/^/      | /' "$log"
		fails=$((fails + 1))
	fi

	# patching an empty file must produce a whole block
	local empty="$T/empty.yaml" out2="$T/out2.yaml" log2="$T/log2"
	: >"$empty"
	patch_config "$empty" "$spec" "$log2" >"$out2"
	[[ "$(yaml_get "$out2" "derp.server.region_id")" == "999" ]] &&
		printf 'PASS  patcher builds missing blocks from scratch\n' || {
		printf 'FAIL  patcher builds missing blocks from scratch\n'
		fails=$((fails + 1))
	}

	# a config that has almost nothing: every block must be created exactly once
	local bare="$T/bare.yaml" outb="$T/outb.yaml" logb="$T/logb" specb="$T/specb"
	local ndb nderp
	printf 'server_url: https://ha.example.com:8443\n' >"$bare"
	{
		printf 'database.type\tstr\tsqlite\n'
		printf 'database.sqlite.path\tstr\t/var/lib/headscale/db.sqlite\n'
		printf 'derp.server.enabled\traw\ttrue\n'
		printf 'derp.server.region_id\traw\t999\n'
		printf 'derp.paths\tlist\t/etc/headscale/derp-maps/official-mirror.yaml\n'
	} >"$specb"
	patch_config "$bare" "$specb" "$logb" >"$outb"
	ndb="$(grep -c '^database:' "$outb" || true)"
	nderp="$(grep -c '^derp:' "$outb" || true)"
	if [[ $ndb == "1" && $nderp == "1" ]] &&
		[[ "$(yaml_get "$outb" "database.sqlite.path")" == "/var/lib/headscale/db.sqlite" ]] &&
		[[ "$(yaml_get "$outb" "database.type")" == "sqlite" ]] &&
		[[ "$(yaml_get "$outb" "derp.server.region_id")" == "999" ]] &&
		[[ "$(yaml_get "$outb" "derp.server.enabled")" == "true" ]] &&
		grep -q '^    - /etc/headscale/derp-maps/official-mirror.yaml$' "$outb"; then
		printf 'PASS  patcher coalesces a whole tree into single blocks\n'
	else
		printf 'FAIL  patcher coalesces a whole tree into single blocks (database:%s derp:%s)\n' "$ndb" "$nderp"
		sed 's/^/      | /' "$outb"
		fails=$((fails + 1))
	fi

	# the resulting tree must survive a second pass unchanged
	local outb2="$T/outb2.yaml" logb2="$T/logb2"
	patch_config "$outb" "$specb" "$logb2" >"$outb2"
	if cmp -s "$outb" "$outb2"; then
		printf 'PASS  coalesced tree is stable on a second pass\n'
	else
		printf 'FAIL  coalesced tree changed on a second pass\n'
		fails=$((fails + 1))
	fi

	# an insertion at the end of the file must not be merged into the last
	# existing block (that used to nest the database block inside derp.paths)
	local tail="$T/tail.yaml" outt="$T/outt.yaml" logt="$T/logt" spect="$T/spect"
	cat >"$tail" <<'YAML'
server_url: https://ha.example.com:8443
derp:
  paths:
    - /vol1/@appdata/headscale/derp-maps/official-mirror.yaml
YAML
	{
		printf 'database.sqlite.path\tstr\t/var/lib/headscale/db.sqlite\n'
		printf 'derp.paths\tlist\t/etc/headscale/derp-maps/official-mirror.yaml\n'
	} >"$spect"
	patch_config "$tail" "$spect" "$logt" >"$outt"
	if [[ "$(yaml_get "$outt" "database.sqlite.path")" == "/var/lib/headscale/db.sqlite" ]] &&
		grep -q '^database:$' "$outt" &&
		grep -q '^    - /etc/headscale/derp-maps/official-mirror.yaml$' "$outt" &&
		! grep -q '^      - /etc/headscale' "$outt"; then
		printf 'PASS  an end-of-file insert does not merge into the last block\n'
	else
		printf 'FAIL  an end-of-file insert merged into the last block\n'
		sed 's/^/      | /' "$outt"
		fails=$((fails + 1))
	fi

	# idempotency
	local out3="$T/out3.yaml" log3="$T/log3"
	patch_config "$out" "$spec" "$log3" >"$out3"
	if cmp -s "$out" "$out3"; then
		printf 'PASS  patcher is idempotent\n'
	else
		printf 'FAIL  patcher is not idempotent\n'
		fails=$((fails + 1))
	fi

	# every unreadable entry is rewritten next to the map the installer writes,
	# while container paths that are already right stay untouched
	local multi="$T/multi.yaml" outm="$T/outm.yaml" logm="$T/logm" specm="$T/specm"
	cat >"$multi" <<'YAML'
derp:
  paths:
    - /old/host/maps/a.yaml
    - /etc/headscale/derp-maps/b.yaml
    - /vol1/@appdata/headscale/derp-maps/c.yaml
YAML
	printf 'derp.paths\tlist\t/etc/headscale/derp-maps/official-mirror.yaml\n' >"$specm"
	patch_config "$multi" "$specm" "$logm" >"$outm"
	if grep -q '^    - /etc/headscale/derp-maps/a.yaml$' "$outm" &&
		grep -q '^    - /etc/headscale/derp-maps/b.yaml$' "$outm" &&
		grep -q '^    - /etc/headscale/derp-maps/c.yaml$' "$outm" &&
		grep -q '^    - /etc/headscale/derp-maps/official-mirror.yaml$' "$outm" &&
		! grep -q '/old/host/maps' "$outm"; then
		printf 'PASS  patcher rewrites every unreadable entry and keeps readable ones\n'
	else
		printf 'FAIL  multi-entry derp.paths handling\n'
		sed 's/^/      | /' "$outm"
		fails=$((fails + 1))
	fi

	# two old entries with the same file name must not both be loaded
	local dup="$T/dup.yaml" outd="$T/outd.yaml" logd="$T/logd" specd="$T/specd"
	cat >"$dup" <<'YAML'
derp:
  paths:
    - /old1/derp-maps/official-mirror.yaml
    - /old2/derp-maps/official-mirror.yaml
YAML
	printf 'derp.paths\tlist\t/etc/headscale/derp-maps/official-mirror.yaml\n' >"$specd"
	patch_config "$dup" "$specd" "$logd" >"$outd"
	if [[ "$(grep -c '^    - /etc/headscale/derp-maps/official-mirror.yaml$' "$outd" || true)" == "1" ]] &&
		awk -F'\t' '$1 == "DROP" { found = 1 } END { exit !found }' "$logd"; then
		printf 'PASS  a duplicate that resolves to the same file is dropped\n'
	else
		printf 'FAIL  duplicate derp.paths entries\n'
		sed 's/^/      | /' "$outd"
		fails=$((fails + 1))
	fi

	# yaml_list reads exactly the items of the requested block
	if [[ "$(yaml_list "$outm" "derp.paths" | wc -l | tr -d ' ')" == "4" ]] &&
		[[ "$(yaml_list "$outm" "derp.server.region_id" | wc -l | tr -d ' ')" == "0" ]]; then
		printf 'PASS  yaml_list reads one list block\n'
	else
		printf 'FAIL  yaml_list returned: %s\n' "$(yaml_list "$outm" "derp.paths" | tr '\n' ' ')"
		fails=$((fails + 1))
	fi

	# container paths resolve to host paths, and only inside the two mounts
	local s_etc="$HS_ETC" s_data="$HS_DATA"
	HS_ETC="$T/etc/headscale"
	HS_DATA="$T/var/lib/headscale"
	if [[ "$(container_to_host_path "/etc/headscale/derp-maps/x.yaml")" == "$HS_ETC/derp-maps/x.yaml" ]] &&
		[[ "$(container_to_host_path "/var/lib/headscale/db.sqlite")" == "$HS_DATA/db.sqlite" ]] &&
		! container_to_host_path "/vol1/@appdata/headscale/x.yaml" >/dev/null 2>&1; then
		printf 'PASS  container_to_host_path maps the mounted roots only\n'
	else
		printf 'FAIL  container_to_host_path\n'
		fails=$((fails + 1))
	fi
	HS_ETC="$s_etc"
	HS_DATA="$s_data"

	# the derp.paths check: a real run refuses a config Headscale cannot read,
	# a dry run only warns
	local badyaml="$T/bad-derp.yaml" vout="" s_ctr="$DERP_MAP_CTR" s_host="$DERP_MAP_HOST"
	DERP_MAP_CTR="/etc/headscale/derp-maps/official-mirror.yaml"
	DERP_MAP_HOST="$HS_ETC/derp-maps/official-mirror.yaml"
	cat >"$badyaml" <<'YAML'
derp:
  paths:
    - /etc/headscale/derp-maps/missing.yaml
    - /old/host/maps/gone.yaml
YAML
	vout="$(verify_derp_paths "$badyaml" plan 2>&1)" || true
	if [[ $vout == *"no file behind it"* && $vout == *"outside"* ]]; then
		printf 'PASS  the plan-phase derp.paths check reports both problems\n'
	else
		printf 'FAIL  the plan-phase derp.paths check said: %s\n' "$vout"
		fails=$((fails + 1))
	fi
	if (verify_derp_paths "$badyaml" real) >/dev/null 2>&1; then
		printf 'FAIL  the real-phase derp.paths check accepted a broken config\n'
		fails=$((fails + 1))
	else
		printf 'PASS  the real-phase derp.paths check refuses a broken config\n'
	fi
	cat >"$badyaml" <<'YAML'
derp:
  paths:
    - /etc/headscale/derp-maps/official-mirror.yaml
YAML
	if vout="$(verify_derp_paths "$badyaml" real 2>&1)"; then
		if [[ $vout != *"would stop Headscale"* && $vout != *"outside"* ]]; then
			printf 'PASS  the real-phase derp.paths check accepts the map it creates\n'
		else
			printf 'FAIL  the real-phase derp.paths check rejected its own placeholder: %s\n' "$vout"
			fails=$((fails + 1))
		fi
	else
		printf 'FAIL  the real-phase derp.paths check failed on a good config\n'
		fails=$((fails + 1))
	fi
	DERP_MAP_CTR="$s_ctr"
	DERP_MAP_HOST="$s_host"

	# a migration copies the old installation and leaves an owner-only backup:
	# the archive holds the database and both private keys
	if have tar; then
		local mig="$T/migrate" m_etc="$T/migrate-etc" m_data="$T/migrate-data"
		local m_backup="$T/migrate-backups" m_mode="" m_archive="$T/none" m_chmodlog="$T/chmod-calls"
		local m_posix=0 m_probe="$T/mode-probe"
		local s_mig="$MIGRATE_SRC" s_backup="$BACKUP_DIR" s_etc2="$HS_ETC" s_data2="$HS_DATA" s_dry="$DRY_RUN"
		mkdir -p "$mig" "$m_etc" "$m_data" "$m_backup"
		printf 'server_url: https://old.example.com:8443\n' >"$mig/config.yaml"
		printf 'SQLite format 3\n' >"$mig/db.sqlite"
		printf 'noise\n' >"$mig/noise_private.key"
		mkdir -p "$mig/derp-maps"
		printf 'regions: {}\n' >"$mig/derp-maps/official-mirror.yaml"
		# Windows file systems cannot express 0600, so assert the chmod call and
		# only check the resulting mode where the platform reports POSIX bits
		: >"$m_probe"
		chmod 600 "$m_probe" 2>/dev/null || true
		[[ "$(stat -c '%a' "$m_probe" 2>/dev/null || true)" == "600" ]] && m_posix=1
		chmod() { printf 'chmod %s %s\n' "$1" "$2" >>"$m_chmodlog"; }
		MIGRATE_SRC="$mig"
		BACKUP_DIR="$m_backup"
		HS_ETC="$m_etc"
		HS_DATA="$m_data"
		DRY_RUN=0
		run_migration "selftest" >/dev/null 2>&1 || true
		unset -f chmod
		m_archive="$m_backup/headscale-pre-migration-selftest.tar.gz"
		m_mode="$(stat -c '%a' "$m_archive" 2>/dev/null || true)"
		if [[ -s "$m_archive" ]] &&
			[[ -s "$m_etc/config.yaml" ]] &&
			[[ -s "$m_data/db.sqlite" ]] &&
			[[ -s "$m_etc/derp-maps/official-mirror.yaml" ]] &&
			[[ -e "$m_chmodlog" ]] &&
			grep -q "600 $m_archive" "$m_chmodlog" &&
			{ ((m_posix == 0)) || [[ $m_mode == "600" ]]; }; then
			printf 'PASS  a migration copies the old installation and writes a 600 backup\n'
		else
			printf 'FAIL  migration backup: mode=%s size=%s chmod logged=%s\n' \
				"${m_mode:-unknown}" "$(wc -c <"$m_archive" 2>/dev/null | tr -d ' ' || printf '?')" \
				"$(grep -c "600 $m_archive" "$m_chmodlog" 2>/dev/null || true)"
			fails=$((fails + 1))
		fi
		MIGRATE_SRC="$s_mig"
		BACKUP_DIR="$s_backup"
		HS_ETC="$s_etc2"
		HS_DATA="$s_data2"
		DRY_RUN="$s_dry"
	fi

	# ---- compose: admin exposure and where pid: host belongs --------------
	local cx="" c_save_bind="$ADMIN_BIND" c_save_listen="$HP_LISTEN_ADDR" c_save_net="$HOST_NETWORK" c_save_hp="$HP_PORT"
	HP_PORT="4100"
	HOST_NETWORK=0
	ADMIN_BIND="0.0.0.0"
	cx="$(build_compose_content)"
	if grep -q '^      - "4100:4100"$' <<<"$cx" && ! grep -q '127.0.0.1:4100:4100' <<<"$cx"; then
		printf 'PASS  the admin port is published on every interface by default\n'
	else
		printf 'FAIL  bridge compose does not publish the admin port on every interface\n'
		fails=$((fails + 1))
	fi
	ADMIN_BIND="127.0.0.1"
	cx="$(build_compose_content)"
	if grep -q '^      - "127.0.0.1:4100:4100"$' <<<"$cx"; then
		printf 'PASS  a local-only admin UI is published on 127.0.0.1 only\n'
	else
		printf 'FAIL  bridge compose still publishes the admin port on every interface\n'
		fails=$((fails + 1))
	fi
	HOST_NETWORK=1
	cx="$(build_compose_content)"
	if ! grep -q '^    ports:$' <<<"$cx" && [[ "$(grep -c '^    pid: "host"$' <<<"$cx")" == "1" ]]; then
		printf 'PASS  only the headplane service shares the host PID namespace\n'
	else
		printf 'FAIL  pid: "host" is on the wrong service (found %s)\n' "$(grep -c '^    pid: "host"$' <<<"$cx")"
		fails=$((fails + 1))
	fi
	HP_LISTEN_ADDR="127.0.0.1"
	if grep -q '^  host: "127.0.0.1"$' <<<"$(hp_config_skeleton)"; then
		printf 'PASS  a local-only admin UI is written as server.host 127.0.0.1\n'
	else
		printf 'FAIL  hp_config_skeleton ignores the admin bind address\n'
		fails=$((fails + 1))
	fi
	ADMIN_BIND="$c_save_bind"
	HP_LISTEN_ADDR="$c_save_listen"
	HOST_NETWORK="$c_save_net"
	HP_PORT="$c_save_hp"

	printf '\n%d failure(s)\n' "$fails"
	((fails == 0)) || return 1
	return 0
}

# -----------------------------------------------------------------------------
# Argument parsing
# -----------------------------------------------------------------------------
parse_args() {
	while (($# > 0)); do
		case "$1" in
		-h | --help)
			usage
			exit 0
			;;
		-n | --dry-run)
			DRY_RUN=1
			;;
		--self-test)
			SELF_TEST=1
			;;
		--defaults)
			USE_DEFAULTS=1
			;;
		--version)
			printf '%s %s\n' "$SCRIPT_NAME" "$SCRIPT_VERSION"
			exit 0
			;;
		--base-dir)
			[[ $# -ge 2 ]] || die "--base-dir needs a value"
			OPT_BASE_DIR="$2"
			shift
			;;
		--headscale-tag)
			[[ $# -ge 2 ]] || die "--headscale-tag needs a value"
			OPT_HS_IMAGE="$2"
			shift
			;;
		--headplane-tag)
			[[ $# -ge 2 ]] || die "--headplane-tag needs a value"
			OPT_HP_IMAGE="$2"
			shift
			;;
		--server-url)
			[[ $# -ge 2 ]] || die "--server-url needs a value"
			OPT_SERVER_URL="$2"
			shift
			;;
		--derp-host)
			[[ $# -ge 2 ]] || die "--derp-host needs a value"
			OPT_DERP_HOST="$2"
			shift
			;;
		--admin-host)
			[[ $# -ge 2 ]] || die "--admin-host needs a value"
			OPT_ADMIN_HOST="$2"
			shift
			;;
		--admin-port)
			[[ $# -ge 2 ]] || die "--admin-port needs a value"
			OPT_HP_PORT="$2"
			shift
			;;
		--admin-bind)
			[[ $# -ge 2 ]] || die "--admin-bind needs a value"
			OPT_ADMIN_BIND="$2"
			shift
			;;
		--stun-port)
			[[ $# -ge 2 ]] || die "--stun-port needs a value"
			OPT_STUN_PORT="$2"
			shift
			;;
		--tz)
			[[ $# -ge 2 ]] || die "--tz needs a value"
			OPT_TZ="$2"
			shift
			;;
		--region-id)
			[[ $# -ge 2 ]] || die "--region-id needs a value"
			OPT_REGION_ID="$2"
			shift
			;;
		--)
			shift
			break
			;;
		*)
			err "unknown option: $1"
			err "run with --help to see all flags"
			exit 2
			;;
		esac
		shift
	done
	return 0
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
	SELF_TEST=0
	parse_args "$@"
	[[ -n ${RUN_TS:-} ]] || RUN_TS="$(date '+%Y-%m-%d %H:%M:%S')"
	[[ -n ${RUN_STAMP:-} ]] || RUN_STAMP="$(date '+%Y%m%d-%H%M%S')"
	TMP_ROOT="$(new_tmp_dir)"
	trap cleanup EXIT
	trap 'exit 130' INT
	trap 'exit 143' TERM

	if ((SELF_TEST)); then
		self_test
		return 0
	fi

	say "${C_BOLD}$SCRIPT_NAME v$SCRIPT_VERSION${C_OFF}"
	say "This installer deploys two containers (Headscale + HeadplaneCN) as described in"
	say "docs/install/dual-image.md. It never deletes your data and never runs git."
	if ((DRY_RUN == 0)); then
		if confirm "Preview only, as a dry run (nothing will be written or started)?" n; then
			DRY_RUN=1
		fi
	fi
	if ((DRY_RUN)); then
		say "MODE: dry run - nothing will be written or started"
	else
		say "MODE: install (files are only written after the plan is confirmed)"
	fi

	preflight
	step_base_dir
	step_images
	step_urls
	step_network
	step_secrets
	step_derp
	step_migration

	print_plan

	if ((DRY_RUN == 0)); then
		say ""
		if ! confirm "Write these files now?" y; then
			die "aborted by the operator; nothing was written"
		fi
	fi

	head2 "Step 8/9  Writing"
	# The chosen directories, created with the mode each one needs: 700 for the
	# two data directories (they hold the database, the private keys and the
	# sessions), 755 for the config and DERP directories.
	act_mkdir "$(dirname "$HP_CONFIG")" 755
	act_mkdir "$HP_DATA" 700
	act_mkdir "$HS_ETC" 755
	act_mkdir "$DERP_MAP_DIR" 755
	act_mkdir "$HS_DATA" 700
	act_mkdir "$BACKUP_DIR" 700

	if ((MIGRATE_ACTIVE)); then
		run_migration "$RUN_STAMP"
	fi

	# Headscale config: patch an adopted/migrated file, otherwise write a skeleton
	emit ""
	emit "--- Headscale configuration ---"
	write_headscale_config "$RUN_STAMP"

	# HeadplaneCN config
	emit ""
	emit "--- HeadplaneCN configuration ---"
	write_headplane_config "$RUN_STAMP"

	# DERP map placeholder (Headscale exits if derp.paths points at a missing file)
	emit ""
	if [[ -e $DERP_MAP_HOST ]]; then
		dim "  DERP map already present: $DERP_MAP_HOST"
	else
		if ((DRY_RUN)); then
			emit "  [dry-run] printf 'regions: {}\n' > $DERP_MAP_HOST   (placeholder so Headscale can start)"
		else
			stage_file "$DERP_MAP_HOST" 644 < <(printf 'regions: {}\n')
		fi
	fi

	# compose file
	emit ""
	emit "--- compose file ---"
	if [[ -e $COMPOSE_FILE ]]; then
		act_backup_file "$COMPOSE_FILE" "$RUN_STAMP"
	fi
	stage_file "$COMPOSE_FILE" 644 < <(build_compose_content)

	# permissions
	emit ""
	emit "--- permissions ---"
	local p
	for p in "$HP_CONFIG" "$HS_ETC/config.yaml" "$HS_DATA/noise_private.key" "$HS_DATA/derp_server_private.key"; do
		if ((DRY_RUN)); then
			emit "  [dry-run] chmod 600 $p"
		elif [[ -e $p ]]; then
			chmod 600 "$p" 2>/dev/null && ok "  chmod 600 $p" || warn "could not chmod 600 $p"
		fi
	done
	# ownership of the Headscale side (config dir incl. the DERP maps, and data).
	# HP_DATA is left alone: the headplane container writes it as its own user.
	local own
	for own in "$HS_ETC" "$HS_DATA"; do
		if ! v_recursive_chown_target "$own"; then
			warn "not changing the ownership of $own"
			continue
		fi
		if ((DRY_RUN)); then
			emit "  [dry-run] chown -R 0:0 $own"
		elif ((ROOT_UID == 0)); then
			chown -R 0:0 "$own" 2>/dev/null && dim "  chown -R 0:0 $own" || warn "chown failed for $own"
		fi
	done

	# validate the compose file when docker is available
	if have docker && ((DRY_RUN == 0)); then
		if (cd "$BASE_DIR" && docker compose config -q) 2>/dev/null; then
			ok "  docker compose config: valid"
		else
			warn "docker compose config reported a problem; check $COMPOSE_FILE"
		fi
	fi

	# start
	head2 "Step 9/9  Start and verify"
	if ((DRY_RUN)); then
		say "dry run: the stack was not started. Commands you would run now:"
		say "  cd $BASE_DIR && docker compose up -d"
		say "  cd $BASE_DIR && docker compose ps"
		say "  cd $BASE_DIR && docker compose logs --tail=30 headscale"
		say "  cd $BASE_DIR && docker compose exec headscale headscale version"
	else
		if confirm "Start the stack now (docker compose up -d)?" n; then
			if (cd "$BASE_DIR" && docker compose up -d); then
				ok "  docker compose up -d finished"
				run_verification
			else
				warn "docker compose up -d failed; nothing else was changed. Inspect the output above."
			fi
		else
			dim "  not started. Start it later with: cd $BASE_DIR && docker compose up -d"
		fi
	fi

	print_summary
	if ((DRY_RUN)); then
		emit ""
		emit "DRY RUN: no files were written outside the temporary directory and no container was started."
	fi
	return 0
}

main "$@"
