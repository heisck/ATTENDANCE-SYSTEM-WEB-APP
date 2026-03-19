import { describe, expect, it } from "vitest";
import {
  buildCloudinaryPublicId,
  isCloudinaryAssetUrlAllowed,
} from "./cloudinary";

describe("cloudinary helpers", () => {
  it("builds normalized public ids", () => {
    expect(
      buildCloudinaryPublicId({
        folder: "/assignments/org-1/announce-1/",
        publicId: "/17123-proof-file/",
      })
    ).toBe("assignments/org-1/announce-1/17123-proof-file");
  });

  it("accepts matching Cloudinary asset urls", () => {
    expect(
      isCloudinaryAssetUrlAllowed({
        url: "https://res.cloudinary.com/demo/raw/upload/v1234/assignments/org-1/a1/file-1.pdf",
        resourceType: "raw",
        fullPublicId: "assignments/org-1/a1/file-1",
      })
    ).toBe(true);
  });

  it("rejects mismatched hosts and asset paths", () => {
    expect(
      isCloudinaryAssetUrlAllowed({
        url: "https://evil.example/raw/upload/v1/assignments/org-1/a1/file-1.pdf",
        resourceType: "raw",
        fullPublicId: "assignments/org-1/a1/file-1",
      })
    ).toBe(false);

    expect(
      isCloudinaryAssetUrlAllowed({
        url: "https://res.cloudinary.com/demo/raw/upload/v1234/assignments/org-1/a1/other-file.pdf",
        resourceType: "raw",
        fullPublicId: "assignments/org-1/a1/file-1",
      })
    ).toBe(false);
  });
});
