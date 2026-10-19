// Manually runs one pass of the billing job (renewals, expiry, reactivation).
// Useful for tests and for backfilling without waiting for the scheduler.
import "dotenv/config";
import { runBillingCycle } from "../server/src/services/billing.js";

runBillingCycle()
  .then((result) => {
    console.log("Billing cycle complete:", result);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
