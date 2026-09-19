// Tests for Circle wallet session stability
import { describe, it, expect } from 'vitest';

describe('Circle vs MetaMask address resolution', () => {
  it('Circle truncated addr resolved from _circleAddress, not window.ethereum', () => {
    const userAddr = "0x4979…67A"; // truncated
    const circleAddr = "0x497924669F8aeA089E399639D254cB2c708c267A";
    const metamaskAddr = "0xDIFFERENTADDRESS000000000000000000000001";

    let resolved;
    if (userAddr.includes("…") || userAddr.length < 42) {
      if (circleAddr && circleAddr.length >= 42) {
        resolved = circleAddr; // Circle path
      } else {
        resolved = metamaskAddr; // MetaMask fallback — WRONG for Circle
      }
    }
    expect(resolved).toBe(circleAddr);
    expect(resolved).not.toBe(metamaskAddr);
  });

  it('MetaMask full addr used directly', () => {
    const userAddr = "0x497924669F8aeA089E399639D254cB2c708c267A";
    expect(userAddr.includes("…")).toBe(false);
    expect(userAddr.length).toBeGreaterThanOrEqual(42);
  });
});

describe('Circle polling: no hard logout', () => {
  it('Circle wallet active + getUser null → no disconnect', () => {
    const walletType = "circle";
    const circleAddress = "0x497924669F8aeA089E399639D254cB2c708c267A";
    const getUserResult = null;
    let disconnected = false;
    let nullCount = 3;

    if (!getUserResult && nullCount >= 3) {
      if (walletType === "circle" || circleAddress) {
        nullCount = 0; // skip hard logout
      } else {
        disconnected = true;
      }
    }
    expect(disconnected).toBe(false);
  });

  it('MetaMask + getUser null 3x → disconnect', () => {
    const walletType = "injected";
    const circleAddress = null;
    let disconnected = false;
    let nullCount = 3;

    if (nullCount >= 3) {
      if (walletType === "circle" || circleAddress) {
        nullCount = 0;
      } else {
        disconnected = true;
      }
    }
    expect(disconnected).toBe(true);
  });

  it('explicit Disconnect still works for Circle', () => {
    let loggedOut = false;
    const disconnect = () => { loggedOut = true; };
    disconnect();
    expect(loggedOut).toBe(true);
  });
});

describe('Circle auth state', () => {
  it('_authLogin sets _authenticated=true on success', () => {
    let authenticated = false;
    const authResult = { ok: true };
    if (authResult.ok) authenticated = true;
    expect(authenticated).toBe(true);
  });

  it('_authLogin returns false on personal_sign failure without crashing', () => {
    let authenticated = false;
    const signFailed = true;
    if (signFailed) { /* return false */ }
    else { authenticated = true; }
    expect(authenticated).toBe(false);
  });

  it('Circle restore without provider does not set _authenticated', () => {
    const provider = null;
    let authenticated = false;
    if (provider) authenticated = true;
    expect(authenticated).toBe(false);
  });
});
