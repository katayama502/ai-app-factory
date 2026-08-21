import { describe, expect, it } from "vitest";
import { renderList } from "../src/render/list.js";

describe("renderList", () => {
  it("renders one row per record with escaped cell values", () => {
    const html = renderList({
      columns: ["customerName", "amount"],
      labels: { customerName: "Customer", amount: "Amount" },
      rows: [{ customerName: "<script>", amount: 100 }],
      searchFields: [],
      searchQuery: "",
      searchAction: "/apps/x/pages/1",
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<th>Customer</th>");
    expect(html).toContain("<th>Amount</th>");
  });

  it("shows a placeholder row when there are no records", () => {
    const html = renderList({
      columns: ["a"],
      labels: {},
      rows: [],
      searchFields: [],
      searchQuery: "",
      searchAction: "/apps/x/pages/1",
    });
    expect(html).toContain("データがありません");
  });

  it("renders a search box only when search fields are declared", () => {
    const withSearch = renderList({
      columns: ["a"],
      labels: {},
      rows: [],
      searchFields: ["a"],
      searchQuery: "",
      searchAction: "/apps/x/pages/1",
    });
    expect(withSearch).toContain('<form class="search"');

    const withoutSearch = renderList({
      columns: ["a"],
      labels: {},
      rows: [],
      searchFields: [],
      searchQuery: "",
      searchAction: "/apps/x/pages/1",
    });
    expect(withoutSearch).not.toContain('<form class="search"');
  });
});
