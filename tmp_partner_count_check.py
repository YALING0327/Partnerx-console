import json
import urllib.parse
import urllib.request
from pathlib import Path


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in Path(".env.local").read_text().splitlines():
        if "=" not in line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


ENV = load_env()
BASE = ENV["SUPABASE_REST_URL"].rstrip("/")
KEY = ENV["SUPABASE_SERVICE_ROLE_KEY"]
HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}


def get(path: str, params: dict[str, str]):
    url = BASE + path + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode())


def main():
    target = "250194588"
    queries = [
        (
            "employees.id",
            "/employees",
            {
                "select": "id,company_id,account_id,employee_name,invite_code,inviter_id,attribution_key,status,created_at",
                "id": f"eq.{target}",
            },
        ),
        (
            "employees.account_id",
            "/employees",
            {
                "select": "id,company_id,account_id,employee_name,invite_code,inviter_id,attribution_key,status,created_at",
                "account_id": f"eq.{target}",
            },
        ),
        (
            "employees.inviter_id",
            "/employees",
            {
                "select": "id,company_id,account_id,employee_name,invite_code,inviter_id,attribution_key,status,created_at",
                "inviter_id": f"eq.{target}",
            },
        ),
        (
            "company_accounts.id",
            "/company_accounts",
            {
                "select": "id,company_id,role,username,name,status,created_at",
                "id": f"eq.{target}",
            },
        ),
    ]

    for label, path, params in queries:
        print(f"\n[{label}]")
        print(json.dumps(get(path, params), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
