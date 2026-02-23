import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type ArtifactStorageBackend = "s3" | "local";

export type ArtifactStorageConfig = {
  backend: ArtifactStorageBackend;
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  localDir: string;
};

export type StoredArtifact = {
  sha256: string;
  storageKey: string;
  byteSize: number;
  contentType: string;
};

export function sha256Hex(input: Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function defaultArtifactConfigFromEnv(): ArtifactStorageConfig {
  const backend = (process.env.KRYFTO_ARTIFACT_BACKEND ??
    "s3") as ArtifactStorageBackend;
  const config: ArtifactStorageConfig = {
    backend,
    bucket: process.env.S3_BUCKET ?? "collector-artifacts",
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE
      ? process.env.S3_FORCE_PATH_STYLE === "true"
      : true,
    localDir:
      process.env.KRYFTO_LOCAL_ARTIFACT_DIR ??
      path.join(process.cwd(), "data", "artifacts"),
  };

  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
  }
  if (process.env.S3_ACCESS_KEY) {
    config.accessKeyId = process.env.S3_ACCESS_KEY;
  }
  if (process.env.S3_SECRET_KEY) {
    config.secretAccessKey = process.env.S3_SECRET_KEY;
  }
  return config;
}

export class ArtifactStorage {
  private readonly config: ArtifactStorageConfig;
  private readonly s3: S3Client | null;

  constructor(config: ArtifactStorageConfig) {
    this.config = config;
    if (config.backend === "s3") {
      const s3Config: ConstructorParameters<typeof S3Client>[0] = {
        region: config.region,
      };

      if (config.endpoint) {
        s3Config.endpoint = config.endpoint;
      }
      if (config.forcePathStyle !== undefined) {
        s3Config.forcePathStyle = config.forcePathStyle;
      }
      if (config.accessKeyId && config.secretAccessKey) {
        s3Config.credentials = {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        };
      }

      this.s3 = new S3Client(s3Config);
    } else {
      this.s3 = null;
    }
  }

  async putBuffer(
    storageKey: string,
    payload: Buffer,
    contentType: string
  ): Promise<StoredArtifact> {
    const digest = sha256Hex(payload);

    if (this.config.backend === "s3") {
      if (!this.s3) throw new Error("S3 client not configured");
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
          Body: payload,
          ContentType: contentType,
        })
      );
    } else {
      const fullPath = path.join(this.config.localDir, storageKey);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, payload);
    }

    return {
      sha256: digest,
      storageKey,
      byteSize: payload.byteLength,
      contentType,
    };
  }

  async getBuffer(storageKey: string): Promise<Buffer> {
    if (this.config.backend === "s3") {
      if (!this.s3) throw new Error("S3 client not configured");
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: storageKey,
        })
      );
      const chunks: Buffer[] = [];
      const stream = response.Body;
      if (
        !stream ||
        typeof (stream as NodeJS.ReadableStream).on !== "function"
      ) {
        throw new Error("S3 stream unavailable");
      }
      await new Promise<void>((resolve, reject) => {
        (stream as NodeJS.ReadableStream).on("data", (chunk) =>
          chunks.push(Buffer.from(chunk))
        );
        (stream as NodeJS.ReadableStream).on("error", reject);
        (stream as NodeJS.ReadableStream).on("end", () => resolve());
      });
      return Buffer.concat(chunks);
    }

    const fullPath = path.join(this.config.localDir, storageKey);
    return readFile(fullPath);
  }

  async createSignedReadUrl(
    storageKey: string,
    ttlSeconds = 300
  ): Promise<string | null> {
    if (this.config.backend !== "s3" || !this.s3) {
      return null;
    }

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: storageKey,
    });

    return getSignedUrl(this.s3, command, { expiresIn: ttlSeconds });
  }
}

export function artifactFileExt(contentType: string): string {
  if (contentType.includes("json")) return "json";
  if (contentType.includes("html")) return "html";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("har")) return "har";
  if (contentType.includes("text")) return "txt";
  return "bin";
}

export function makeArtifactStorageKey(
  projectId: string,
  sha: string,
  contentType: string
): string {
  const ext = artifactFileExt(contentType);
  return `${projectId}/${sha.slice(0, 2)}/${sha}.${ext}`;
}

export function resolveRepoPath(...parts: string[]): string {
  const currentFile = fileURLToPath(import.meta.url);
  const sharedSrc = path.dirname(currentFile);
  const repoRoot = path.resolve(sharedSrc, "..", "..", "..");
  return path.join(repoRoot, ...parts);
}
