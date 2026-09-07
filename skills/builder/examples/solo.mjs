/** One cohesive atomic state transition: splitting debit/check across workers is unsafe. */
export function createLedger(initialBalance) {
  if (!Number.isSafeInteger(initialBalance) || initialBalance < 0) throw new RangeError('Invalid balance');
  let balance = initialBalance;
  return {
    reserve(amount) {
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > balance) throw new RangeError('Invalid reservation');
      balance -= amount;
      return balance;
    },
    balance: () => balance,
  };
}
