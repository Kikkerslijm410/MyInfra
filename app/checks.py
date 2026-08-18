import requests

def get_outbound_ip():
    resp = requests.get("https://api.ipify.org?format=json", timeout=5)
    resp.raise_for_status()
    return resp.json()["ip"]
