import httpx
import asyncio
import json

async def test_endpoint():
    url = "http://localhost:8003/api/ai/adjustments/generate-from-ledger"
    
    payload = {
        "company_id": "1",  # Whatever the user's company is, we assume 1 for test
        "accounts": [],
        "parameters": {
            "use_trajectory_mode": True,
            "ufv_initial": 2.56041,
            "ufv_final": 2.57833,
            "trajectory_start_date": "2024-12-01",
            "trajectory_end_date": "2024-12-31",
            "api_base_url": "http://localhost:3000"
        }
    }
    
    timeout = httpx.Timeout(60.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(url, json=payload)
            print(f"Status: {resp.status_code}")
            data = resp.json()
            if resp.status_code != 200:
                print(json.dumps(data, indent=2))
                return
            
            # Find Costo de ventas
            for item in data.get("proposedTransactions", []):
                for entry in item.get("entries", []):
                    pass
            for row in data.get("diagnostics", []):
                if "costo" in str(row.get("name", "")).lower() or "600-10-01" in str(row.get("code", "")):
                    print(json.dumps(row, indent=2))
            
            print("Stats:", json.dumps(data.get("processing_stats", {}), indent=2))
        except Exception as e:
            print(f"Error: {e}")

asyncio.run(test_endpoint())
