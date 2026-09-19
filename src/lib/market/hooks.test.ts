import { describe, expect, it } from "vitest";
import { chunkWatchlist } from "./hooks";

describe("chunkWatchlist", () => {
  it("splits a watchlist into fixed-size groups in order", () => {
    const chunks = chunkWatchlist(["A", "B", "C", "D", "E", "F"], 2);
    expect(chunks).toEqual([
      ["A", "B"],
      ["C", "D"],
      ["E", "F"],
    ]);
  });

  it("keeps the final short chunk rather than dropping leftover symbols", () => {
    const chunks = chunkWatchlist(["A", "B", "C", "D", "E"], 2);
    expect(chunks).toEqual([["A", "B"], ["C", "D"], ["E"]]);
  });

  it("returns one chunk containing everything when size covers the whole list", () => {
    const chunks = chunkWatchlist(["A", "B"], 10);
    expect(chunks).toEqual([["A", "B"]]);
  });

  it("returns no chunks for an empty watchlist", () => {
    expect(chunkWatchlist([], 2)).toEqual([]);
  });

  it("treats a non-positive size as one chunk holding everything, rather than looping forever", () => {
    expect(chunkWatchlist(["A", "B"], 0)).toEqual([["A", "B"]]);
    expect(chunkWatchlist([], 0)).toEqual([]);
  });

  it("never mutates the input array", () => {
    const input = ["A", "B", "C"];
    chunkWatchlist(input, 2);
    expect(input).toEqual(["A", "B", "C"]);
  });
});
