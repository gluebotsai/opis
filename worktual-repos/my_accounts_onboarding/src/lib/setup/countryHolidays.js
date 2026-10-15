/** Country holiday catalogs for Setup Business Hours (name + typical date for current year). */

function yearDates(entries) {
  const year = new Date().getFullYear();
  return entries.map(([name, month, day]) => ({
    name,
    holidayDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  }));
}

export const SETUP_HOLIDAY_COUNTRIES = [
  "India",
  "United States",
  "United Kingdom",
  "Singapore",
];

const CATALOG = {
  India: yearDates([
    ["New Year's Day", 1, 1],
    ["Republic Day", 1, 26],
    ["Independence Day", 8, 15],
    ["Gandhi Jayanti", 10, 2],
    ["Diwali", 11, 8],
    ["Christmas", 12, 25],
  ]),
  "United States": yearDates([
    ["New Year's Day", 1, 1],
    ["MLK Day", 1, 19],
    ["Memorial Day", 5, 25],
    ["Independence Day", 7, 4],
    ["Thanksgiving", 11, 26],
    ["Christmas", 12, 25],
  ]),
  "United Kingdom": yearDates([
    ["New Year's Day", 1, 1],
    ["Good Friday", 4, 3],
    ["Easter Monday", 4, 6],
    ["Spring Bank Holiday", 5, 25],
    ["Christmas", 12, 25],
    ["Boxing Day", 12, 26],
  ]),
  Singapore: yearDates([
    ["New Year's Day", 1, 1],
    ["Chinese New Year", 2, 17],
    ["Labour Day", 5, 1],
    ["National Day", 8, 9],
    ["Deepavali", 11, 8],
    ["Christmas", 12, 25],
  ]),
};

export function holidaysForCountry(country) {
  return CATALOG[country] || yearDates([["New Year's Day", 1, 1], ["National Day", 1, 1], ["Labor Day", 5, 1]]);
}

export const SETUP_SHIFT_TYPES = ["Regular", "Morning", "Evening", "Night"];

export const SHIFT_TYPE_DEFAULT_TIMES = {
  Regular: { startTime: "09:00", endTime: "18:00" },
  Morning: { startTime: "06:00", endTime: "14:00" },
  Evening: { startTime: "14:00", endTime: "22:00" },
  Night: { startTime: "22:00", endTime: "06:00" },
};
