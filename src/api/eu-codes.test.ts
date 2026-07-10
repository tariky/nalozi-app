import { test, expect } from "bun:test";
import { formatDisplacement, normalizeFuel, buildMotor, validateVin } from "./eu-codes";

test("formatDisplacement turns cm3 into a litre label", () => {
  expect(formatDisplacement(1968)).toBe("2.0");
  expect(formatDisplacement(1598)).toBe("1.6");
  expect(formatDisplacement(2967)).toBe("3.0");
  expect(formatDisplacement(999)).toBe("1.0");
});

test("formatDisplacement rejects impossible or non-numeric values", () => {
  expect(formatDisplacement(99)).toBe(null);      // below 200 cm3
  expect(formatDisplacement(50000)).toBe(null);   // above 10000 cm3
  expect(formatDisplacement("1968")).toBe(null);  // model must send a number
  expect(formatDisplacement(null)).toBe(null);
  expect(formatDisplacement(NaN)).toBe(null);
});

test("normalizeFuel maps every language in the directive to one Bosnian word", () => {
  for (const raw of ["DIESEL", "Dizel", "GAZOLE", "HEAVY OIL", "Gas Oil", "nafta"]) {
    expect(normalizeFuel(raw)).toEqual({ fuel: "dizel", unknown: false });
  }
  for (const raw of ["PETROL", "ESSENCE", "Benzina", "OTTO", "unleaded"]) {
    expect(normalizeFuel(raw)).toEqual({ fuel: "benzin", unknown: false });
  }
  expect(normalizeFuel("LPG")).toEqual({ fuel: "plin", unknown: false });
  expect(normalizeFuel("CNG")).toEqual({ fuel: "metan", unknown: false });
  expect(normalizeFuel("ELECTRIC")).toEqual({ fuel: "struja", unknown: false });
  expect(normalizeFuel("Hybrid")).toEqual({ fuel: "hibrid", unknown: false });
});

test("normalizeFuel keeps an unrecognised fuel rather than losing it", () => {
  expect(normalizeFuel("VODIK")).toEqual({ fuel: "vodik", unknown: true });
});

test("normalizeFuel treats missing input as absent, not unknown", () => {
  expect(normalizeFuel(null)).toEqual({ fuel: null, unknown: false });
  expect(normalizeFuel("   ")).toEqual({ fuel: null, unknown: false });
  expect(normalizeFuel(42)).toEqual({ fuel: null, unknown: false });
});

test("buildMotor joins only the parts it has", () => {
  expect(buildMotor("2.0", "dizel")).toBe("2.0 dizel");
  expect(buildMotor("2.0", null)).toBe("2.0");
  expect(buildMotor(null, "dizel")).toBe("dizel");
  expect(buildMotor(null, null)).toBe(null);
});

test("validateVin accepts exactly 17 legal characters", () => {
  expect(validateVin("TMBLF93T1F9050884")).toEqual({ vin: "TMBLF93T1F9050884", valid: true });
  // Separators printed on the document are not part of the VIN.
  expect(validateVin(" tmblf93t1f9050884 ")).toEqual({ vin: "TMBLF93T1F9050884", valid: true });
});

test("validateVin rejects I, O, Q and wrong lengths without repairing them", () => {
  expect(validateVin("TMBLF93T1FO050884")).toEqual({ vin: null, valid: false }); // letter O
  expect(validateVin("TMBLF93T1FI050884")).toEqual({ vin: null, valid: false }); // letter I
  expect(validateVin("TMBLF93T1FQ050884")).toEqual({ vin: null, valid: false }); // letter Q
  expect(validateVin("TMBLF93T1F905088")).toEqual({ vin: null, valid: false });  // 16 chars
  expect(validateVin("")).toEqual({ vin: null, valid: false });
  expect(validateVin(null)).toEqual({ vin: null, valid: false });
});
