"""
Test AITB Trajectory Mode (V8.2 Fix Verification)
Expected: Two movements for account "600-10-01" should produce AITB ≈ 60.62, NOT 175.76
"""
import asyncio
from ai_adjustment_engine import ARSDSPyEngine, Account, AdjustmentParameters

def main():
    engine = ARSDSPyEngine()
    
    # User's exact test case: Costo de Ventas with 2 movements in December 2024
    account = Account(
        code="600-10-01",
        name="Costo de ventas",
        balance=25000.0,
        type="Gasto"
    )

    params = AdjustmentParameters(
        ufv_final=2.57833,  # UFV al cierre (31/12/2024)
        ufv_initial=2.56033,  # UFV al inicio de gestión (01/12/2024) - should NOT be used in AoT
        use_trajectory_mode=True,
        trajectory_start_date="2024-12-01",
        trajectory_end_date="2024-12-31",
        ledger_trajectories={
            "600-10-01": [
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
        ufv_cache={
            "2024-12-01": 2.56033,
            "2024-12-08": 2.56404,
            "2024-12-29": 2.57707,
            "2024-12-31": 2.57833
        }
    )

    final_adjustment, avg_confidence, audit_trail, enriched_rule = engine.calculate_aitb_trajectory(account, params)

    print("=" * 60)
    print("AITB TRAJECTORY MODE TEST (V8.2)")
    print("=" * 60)
    print(f"Account: {account.code} - {account.name}")
    print(f"Balance: {account.balance}")
    print(f"Movements: 2 (10000 @ 2.56404, 15000 @ 2.57707)")
    print(f"UFV Final (cierre): {params.ufv_final}")
    print()
    print(f"RESULT: {final_adjustment:.2f} Bs")
    print(f"Audit: {audit_trail}")
    print(f"Confidence: {avg_confidence:.4f}")
    print(f"AoT Atoms: {enriched_rule.get('aot_atoms', '?')}")
    print(f"AoT Mode: {enriched_rule.get('aot_mode', '?')}")
    print()

    # Manual calculation verification
    # Mov1: 10000 * (2.57833/2.56404 - 1) = 10000 * 0.005572 = 55.72
    # Mov2: 15000 * (2.57833/2.57707 - 1) = 15000 * 0.000489 = 7.33 (approx)
    # Expected: ~63.05 (exact depends on bankersRound)
    # Opening balance: 25000 - 25000 = 0, so no opening adj
    
    cc1 = 2.57833 / 2.56404
    adj1 = 10000 * (cc1 - 1)
    cc2 = 2.57833 / 2.57707
    adj2 = 15000 * (cc2 - 1)
    expected = round(adj1, 2) + round(adj2, 2)
    
    print(f"MANUAL VERIFICATION:")
    print(f"  Mov1: 10000 × ({cc1:.6f} - 1) = {adj1:.4f} → {round(adj1, 2):.2f}")
    print(f"  Mov2: 15000 × ({cc2:.6f} - 1) = {adj2:.4f} → {round(adj2, 2):.2f}")
    print(f"  Expected Total: {expected:.2f}")
    print()
    
    # Assertions
    is_aot = "[AITB-AoT]" in audit_trail
    is_in_range = 55 < final_adjustment < 70  # Should be ~60-63, definitely not 175
    is_not_pot = final_adjustment < 100  # PoT would give 175.76
    
    print("ASSERTIONS:")
    print(f"  ✅ Uses AoT path (not PoT): {'PASS' if is_aot else 'FAIL'} → audit contains '[AITB-AoT]': {is_aot}")
    print(f"  ✅ In expected range (55-70): {'PASS' if is_in_range else 'FAIL'} → {final_adjustment:.2f}")
    print(f"  ✅ Not PoT result (<100): {'PASS' if is_not_pot else 'FAIL'} → {final_adjustment:.2f}")
    
    all_pass = is_aot and is_in_range and is_not_pot
    print()
    print(f"{'✅ ALL TESTS PASSED' if all_pass else '❌ SOME TESTS FAILED'}")
    print("=" * 60)
    
    return all_pass

if __name__ == "__main__":
    result = main()
    exit(0 if result else 1)
