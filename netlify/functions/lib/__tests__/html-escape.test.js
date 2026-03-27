"use strict";

const { escapeHtml, safeHttpUrl, textToEmailHtml, formatSectorNoteForEmail } = require("../html-escape");

describe("escapeHtml", () => {
  test("temiz string değişmez", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });

  test("& → &amp;", () => {
    expect(escapeHtml("fish & chips")).toBe("fish &amp; chips");
  });

  test("< ve > → &lt; &gt;", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("çift tırnak → &quot;", () => {
    expect(escapeHtml('He said "hello"')).toBe("He said &quot;hello&quot;");
  });

  test("tek tırnak → &#39;", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  test("null → boş string", () => {
    expect(escapeHtml(null)).toBe("");
  });

  test("undefined → boş string", () => {
    expect(escapeHtml(undefined)).toBe("");
  });

  test("sayı → string olarak işlenir", () => {
    expect(escapeHtml(42)).toBe("42");
  });

  test("tüm tehlikeli karakterler birlikte", () => {
    expect(escapeHtml('<a href="x" onclick=\'alert(1)\'>X & Y</a>')).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;alert(1)&#39;&gt;X &amp; Y&lt;/a&gt;"
    );
  });
});

describe("safeHttpUrl", () => {
  test("geçerli https URL geçer", () => {
    expect(safeHttpUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  test("geçerli http URL geçer", () => {
    expect(safeHttpUrl("http://example.com")).toBe("http://example.com");
  });

  test("javascript: URL engellenir", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBe("");
  });

  test("data: URL engellenir", () => {
    expect(safeHttpUrl("data:text/html,<h1>hi</h1>")).toBe("");
  });

  test("null → boş string", () => {
    expect(safeHttpUrl(null)).toBe("");
  });

  test("boş string → boş string", () => {
    expect(safeHttpUrl("")).toBe("");
  });

  test("sadece protokolsüz domain → engellenir", () => {
    expect(safeHttpUrl("example.com")).toBe("");
  });
});

describe("textToEmailHtml", () => {
  test("düz metin → kaçış uygulanır", () => {
    expect(textToEmailHtml("Hello & World")).toBe("Hello &amp; World");
  });

  test("newline → <br>", () => {
    expect(textToEmailHtml("line1\nline2")).toBe("line1<br>line2");
  });

  test("Windows newline \\r\\n → <br>", () => {
    expect(textToEmailHtml("line1\r\nline2")).toBe("line1<br>line2");
  });

  test("null → boş string", () => {
    expect(textToEmailHtml(null)).toBe("");
  });
});

describe("formatSectorNoteForEmail", () => {
  test("boş → boş string", () => {
    expect(formatSectorNoteForEmail("")).toBe("");
    expect(formatSectorNoteForEmail(null)).toBe("");
  });

  test("düz tire madde işareti listesi → <ul><li> çıktısı", () => {
    const result = formatSectorNoteForEmail("- First item\n- Second item");
    expect(result).toContain("<ul");
    expect(result).toContain("<li");
    expect(result).toContain("First item");
    expect(result).toContain("Second item");
  });

  test("HTML <li> içeren girdi → güvenli <ul><li> çıktısı", () => {
    const result = formatSectorNoteForEmail("<ul><li>HR update</li><li>Payroll alert</li></ul>");
    expect(result).toContain("HR update");
    expect(result).toContain("Payroll alert");
    expect(result).not.toContain("<script");
  });

  test("XSS girişimi → script tag sökülür, yalnızca metin içeriği kalır", () => {
    const result = formatSectorNoteForEmail("- <script>alert(1)</script>");
    // Fonksiyon HTML tag'lerini strip ediyor, sonra escapeHtml uyguluyor.
    // Çıktıda hiç <script> olmamalı (ne escaped ne de raw).
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("&lt;script&gt;");
    // Metin içeriği korunmuş olabilir ama güvenli li öğesi içinde
    expect(result).toContain("<li");
  });
});
