"use strict";

const { digestGreetingDisplayName } = require("../digest-greeting-name");

describe("digestGreetingDisplayName", () => {
  // Null / undefined guard
  test("null kullanıcı → boş string", () => {
    expect(digestGreetingDisplayName(null)).toBe("");
    expect(digestGreetingDisplayName(undefined)).toBe("");
  });

  test("tamamen boş nesne → boş string", () => {
    expect(digestGreetingDisplayName({})).toBe("");
  });

  // first_name önceliği
  test("first_name ≥2 karakter → first_name döner", () => {
    expect(digestGreetingDisplayName({ first_name: "Alp", company_name: "Actaware" })).toBe("Alp");
  });

  test("first_name boşluk trimlenmiş ≥2 karakter → first_name döner", () => {
    expect(digestGreetingDisplayName({ first_name: "  Sara  ", company_name: "Acme" })).toBe("Sara");
  });

  test("first_name tek karakter → company_name'e düşer", () => {
    expect(digestGreetingDisplayName({ first_name: "U", company_name: "Actaware Ltd" })).toBe("Actaware Ltd");
  });

  // 'Hi U' senaryosu — asıl düzelttiğimiz bug
  test("company_name='U' ve first_name yok → boş string (Hi there'e düşer)", () => {
    expect(digestGreetingDisplayName({ company_name: "U" })).toBe("");
  });

  test("company_name tek karakter, first_name tek karakter → boş string", () => {
    expect(digestGreetingDisplayName({ first_name: "A", company_name: "B" })).toBe("");
  });

  // first + last kombinasyonu
  test("first_name boş ama last_name ≥2 → first+last döner", () => {
    expect(digestGreetingDisplayName({ first_name: "", last_name: "Smith" })).toBe("Smith");
  });

  test("first_name 1 karakter + last_name → 'X Smith' döner", () => {
    expect(digestGreetingDisplayName({ first_name: "X", last_name: "Smith" })).toBe("X Smith");
  });

  // company_name fallback
  test("first/last yok, company ≥2 → company döner", () => {
    expect(digestGreetingDisplayName({ company_name: "Acme Corp" })).toBe("Acme Corp");
  });

  test("first/last yok, company 1 karakter → boş string", () => {
    expect(digestGreetingDisplayName({ company_name: "A" })).toBe("");
  });

  // Sayı ve null değerler
  test("first_name sayı olarak gelirse string'e çevrilir", () => {
    expect(digestGreetingDisplayName({ first_name: 42 })).toBe("42");
  });

  test("first_name null, last_name null, company var → company döner", () => {
    expect(digestGreetingDisplayName({ first_name: null, last_name: null, company_name: "Global HR" })).toBe("Global HR");
  });

  // Trim edge case
  test("sadece boşluklardan oluşan first_name → boş sayılır", () => {
    expect(digestGreetingDisplayName({ first_name: "   ", company_name: "Acme" })).toBe("Acme");
  });

  // Görünmez karakter: JS .length ≥2 olsa da ekranda "U" — normalize sonrası company'ye düşmeli
  test("first_name U + zero-width → tek harf, company kullanılır", () => {
    expect(digestGreetingDisplayName({ first_name: "U\u200B", company_name: "Acme Ltd" })).toBe("Acme Ltd");
    expect(digestGreetingDisplayName({ first_name: "U\uFEFF", company_name: "Widgets Co" })).toBe("Widgets Co");
  });
});
