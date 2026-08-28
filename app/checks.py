import socket, ssl, requests
from datetime import datetime, timezone

def check_outbound_ip():
    resp = requests.get("https://api.ipify.org?format=json", timeout=5)
    resp.raise_for_status()
    return resp.json()["ip"]

def check_ssl_expiry(domain, port=443):
    ctx = ssl.create_default_context()
    with socket.create_connection((domain, port), timeout=5) as sock:
        with ctx.wrap_socket(sock, server_hostname=domain) as ssock:
            cert = ssock.getpeercert()
    expires = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    days_left = (expires - datetime.now(timezone.utc)).days
    return {"expires": expires.isoformat(), "days_left": days_left}

def check_reachable(url, timeout=3):
    try:
        resp = requests.get(url, timeout=timeout, allow_redirects=True)
        return {"reachable": True, "status_code": resp.status_code}
    except requests.RequestException as e:
        return {"reachable": False, "error": str(e)}
