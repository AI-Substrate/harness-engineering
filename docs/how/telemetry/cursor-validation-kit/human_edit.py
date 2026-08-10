# Simulates a human edit: a plain python process appends a function to lib.mjs.
# No agent Write tool, no shell heredoc — just python file IO.
BLOCK = """
export function clamp(x, lo, hi) {
  if (typeof x !== "number") {
    throw new TypeError("clamp expects a number");
  }
  if (lo > hi) {
    throw new RangeError("clamp: lo must not exceed hi");
  }
  if (x < lo) {
    return lo;
  }
  if (x > hi) {
    return hi;
  }
  return x;
}
"""
with open("lib.mjs", "a") as f:
    f.write(BLOCK)
print("appended clamp() block")
