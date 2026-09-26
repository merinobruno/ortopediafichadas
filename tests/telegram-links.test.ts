import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../server/store";
import {
  issueLinkCode,
  consumeLinkCode,
  hashLinkCode,
  revokeLink,
} from "../server/telegram-links";

function fixture() {
  const s = new Store(":memory:");
  s.db.exec(
    "INSERT INTO employees(id,name,role,site_ids,active) VALUES('a','Ana','Staff','[]',1),('b','Bea','Staff','[]',1),('off','Inactive','Staff','[]',0)",
  );
  return s;
}
test("single-use, expiry, active employee and revocation enforce link lifecycle without plaintext", () => {
  const s = fixture();
  try {
    const now = Date.now();
    assert.throws(() => issueLinkCode(s, "off", "hr", now));
    const first = issueLinkCode(s, "a", "hr", now);
    assert.equal(
      JSON.stringify(s.all("SELECT * FROM telegram_codes")).includes(
        first.code,
      ),
      false,
    );
    assert.equal(
      JSON.stringify(s.all("SELECT * FROM audit")).includes(first.code),
      false,
    );
    assert.equal(
      consumeLinkCode(s, hashLinkCode(first.code), "8", "8", now + 900000),
      null,
    );
    const second = issueLinkCode(s, "a", "hr", now);
    assert.equal(
      consumeLinkCode(s, hashLinkCode(second.code), "8", "9", now),
      null,
    );
    assert.equal(
      consumeLinkCode(s, hashLinkCode(second.code), "8", "8", now)?.employeeId,
      "a",
    );
    assert.equal(
      consumeLinkCode(s, hashLinkCode(second.code), "8", "8", now),
      null,
    );
    assert.throws(() => issueLinkCode(s, "a", "hr", now));
    const other = issueLinkCode(s, "b", "hr", now);
    assert.equal(
      consumeLinkCode(s, hashLinkCode(other.code), "8", "8", now),
      null,
    );
    revokeLink(s, "a", "hr", now);
    assert.equal(s.all("SELECT * FROM telegram_links").length, 0);
    assert.equal(
      s.one("SELECT actor FROM audit WHERE reason='Telegram revoked'")?.actor,
      "hr",
    );
  } finally {
    s.db.close();
  }
});
test("five bad guesses per sender in fifteen minutes block a valid code until reset", () => {
  const s = fixture();
  try {
    const now = Date.now();
    const code = issueLinkCode(s, "a", "hr", now);
    for (let i = 0; i < 5; i++)
      assert.equal(
        consumeLinkCode(s, hashLinkCode("AAAAAAAAAA"), "8", "8", now),
        null,
      );
    assert.equal(
      consumeLinkCode(s, hashLinkCode(code.code), "8", "8", now),
      null,
    );
    const renewed = issueLinkCode(s, "a", "hr", now + 900001);
    assert.equal(
      consumeLinkCode(s, hashLinkCode(renewed.code), "8", "8", now + 900001)
        ?.employeeId,
      "a",
    );
  } finally {
    s.db.close();
  }
});
