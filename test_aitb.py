import asyncio
from ai_adjustment_engine import ARSDSPyEngine, Account, AdjustmentParameters, LedgerMovement
from pydantic import BaseModel

async def main():
    engine = ARSDSPyEngine()
    
    # User's test case
    # Account Balance: 25000
    account = Account(
        code="1234",
        name="Muebles y Enseres",
        balance=25000.0,
        type="activo_no_circulante"
    )

    params = AdjustmentParameters(
        ufv_final=2.57833, # cierre
        use_trajectory_mode=True,
        trajectory_start_date="2024-12-01",
        trajectory_end_date="2024-12-31",
        ledger_trajectories={
            "1234": [
                {
                    "date": "2024-12-08",
                    "debit": 10000.0,
                    "credit": 0.0,
                    "ufv_at_date": 2.56404
                },
                {
                    "date": "2024-12-29",
                    "debit": 15000.0,
                    "credit": 0.0,
                    "ufv_at_date": 2.57707
                }
            ]
        },
        ufv_cache={},
        ufv_initial=2.56041 # start of management just in case it falls back
    )

    final_adjustment, avg_confidence, audit_trail, enriched_rule = engine.calculate_aitb_trajectory(account, params)

    with open('out.txt', 'w', encoding='utf-8') as f:
        import sys
        sys.stdout = f
        print("================== RESULTS ==================")
        print(f"Final Adjustment: {final_adjustment}")
        print(f"Audit Trail: {audit_trail}")
        print(f"Rule: {enriched_rule}")
        print("=============================================")
        sys.stdout = sys.__stdout__

if __name__ == "__main__":
    asyncio.run(main())
