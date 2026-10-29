// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import AgencyList from "../../../components/gov/AgencyList";
import type { TriageGroup } from "../../../convex/lib/triageGroups";

afterEach(cleanup);

const GROUPS: TriageGroup[] = [
  { agency: "Mableton Sanitation", owner: "city", slug: "mableton-sanitation", open: 4, fixed: 2 },
  { agency: "Georgia Power", owner: "utility", slug: "georgia-power", open: 0, fixed: 0 },
  { agency: "Routing unclear", owner: "unknown", slug: "routing-unclear", open: 1, fixed: 0 },
];

test("each agency row shows its counts in the given order and links to its queue", () => {
  render(<AgencyList groups={GROUPS} />);
  const links = screen.getAllByRole("link");
  expect(links.map((l) => l.getAttribute("href"))).toEqual([
    "/gov/mableton-sanitation",
    "/gov/georgia-power",
    "/gov/routing-unclear",
  ]);
  const sanitation = links[0];
  expect(within(sanitation).getByText("Mableton Sanitation")).toBeTruthy();
  expect(within(sanitation).getByTestId("open-count").textContent).toBe("4open");
  expect(within(sanitation).getByTestId("fixed-count").textContent).toBe("2fixed");
  // An agency with no reports still gets a row (§5.5.1).
  expect(within(links[1]).getByTestId("open-count").textContent).toBe("0open");
});
