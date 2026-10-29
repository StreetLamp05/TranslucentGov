// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import AgencyQueue from "../../../components/gov/AgencyQueue";
import type { QueueRow, TriageQueue } from "../../../server/lib/triageGroups";

afterEach(cleanup);

const DAY_MS = 86_400_000;

function row(id: string, overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    _id: id,
    title: `Title ${id}`,
    street: "Baker St",
    category: "pothole",
    status: "open",
    meTooCount: 3,
    createdAt: Date.now() - 23 * DAY_MS,
    isSample: false,
    thumbnailUrl: `https://example.test/${id}.jpg`,
    ...overrides,
  };
}

const QUEUE: TriageQueue = {
  agency: "SF Public Works",
  owner: "city",
  open: [row("a", { meTooCount: 9, isSample: true }), row("b")],
  fixed: [row("c", { status: "fixed", createdAt: 0, fixedAt: 4 * DAY_MS })],
};

test("open and fixed sections list rows in order, each linking to its feed card", () => {
  render(<AgencyQueue queue={QUEUE} />);
  const open = screen.getByRole("region", { name: "Open" });
  const openLinks = within(open).getAllByRole("link");
  expect(openLinks.map((l) => l.getAttribute("href"))).toEqual(["/?report=a", "/?report=b"]);
  expect(within(openLinks[0]).getByText("Open · 23 days · 9 me too")).toBeTruthy();
  expect(within(openLinks[0]).getByText("Sample · filmed in California")).toBeTruthy();
  expect(within(openLinks[1]).queryByText(/Sample/)).toBeNull();

  const fixed = screen.getByRole("region", { name: "Recently fixed" });
  const fixedLink = within(fixed).getByRole("link");
  expect(fixedLink.getAttribute("href")).toBe("/?report=c");
  expect(within(fixedLink).getByText("Fixed in 4 days · 3 me too")).toBeTruthy();
});

test("empty sections say so", () => {
  render(<AgencyQueue queue={{ ...QUEUE, open: [], fixed: [] }} />);
  expect(screen.getByText("No open reports.")).toBeTruthy();
  expect(screen.getByText("Nothing fixed yet.")).toBeTruthy();
});
