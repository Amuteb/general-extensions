/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type JSONObject,
  type Chapter as SourceChapter,
  type SourceManga,
} from "@paperback/types";

export interface MangaPlusMetadata extends JSONObject {
  page?: number;
}

export enum Language {
  ENGLISH = "ENGLISH",
  SPANISH = "SPANISH",
  FRENCH = "FRENCH",
  INDONESIAN = "INDONESIAN",
  PORTUGUESE_BR = "PORTUGUESE_BR",
  RUSSIAN = "RUSSIAN",
  THAI = "THAI",
  VIETNAMESE = "VIETNAMESE",
}

export interface MangaPlusResponse {
  success?: SuccessResult;
  error?: ErrorResult;
}

export interface SuccessResult {
  titleDetailView?: TitleDetailView;
  mangaViewer?: MangaViewer;
  allTitlesViewV3?: AllTitlesViewV3;
  titleRankingView?: TitleRankingView;
  webHomeViewV4?: WebHomeViewV4;
}

interface ErrorResult {
  popups: Popup[];
}

interface Popup {
  body: string;
  language?: Language;
}

interface TitleRankingView {
  rankedTitles: {
    titles: Title[];
  }[];
}

interface AllTitlesViewV3 {
  titles: {
    title: Title;
  }[];
}

interface WebHomeViewV4 {
  groups: {
    titles: UpdatedTitle[];
  }[];
}

interface UpdatedTitle {
  latestChapter?: {
    title?: Title;
  };
}

export interface MangaViewer {
  pages: MangaPlusPage[];
  titleId?: number;
  viewToken?: string;
}

interface MangaPlusPage {
  mangaPage?: MangaPage;
}

interface MangaPage {
  imageUrl: string;
  encryptionKey?: string;
}

export function langPopup(
  errorResult: ErrorResult | undefined,
  lang: Language,
): Popup | null {
  return (
    errorResult?.popups?.find(
      (popup) => (popup.language ?? Language.ENGLISH) === lang,
    ) ?? null
  );
}

export class Title {
  titleId: number;
  name: string;
  author?: string;
  portraitImageUrl: string;
  landscapeImageUrl = "";
  viewCount = 0;
  language: Language = Language.ENGLISH;

  constructor(
    titleId: number,
    name: string,
    portraitImageUrl: string,
    landscapeImageUrl = "",
    author?: string,
  ) {
    this.titleId = titleId;
    this.name = name;
    this.portraitImageUrl = portraitImageUrl;
    this.landscapeImageUrl = landscapeImageUrl;

    if (author) this.author = author;
  }
}

export class TitleDetailView {
  title?: Title;
  titleImageUrl?: string;
  overview?: string;
  backgroundImageUrl?: string;
  nextTimeStamp = 0;
  viewingPeriodDescription = "";
  nonAppearanceInfo = "";
  firstChapterList: Chapter[] = [];
  lastChapterList: Chapter[] = [];
  isSimulReleased = false;
  chaptersDescending = true;

  private get isOneShot(): boolean {
    return (
      this.chapterCount === 1 &&
      this.firstChapterList.at(0)?.name?.localeCompare("one-shot", undefined, {
        sensitivity: "base",
      }) === 0
    );
  }

  private get chapterCount(): number {
    return this.firstChapterList.length + this.lastChapterList.length;
  }

  private get isCompleted(): boolean {
    return (
      this.nonAppearanceInfo.toLowerCase().includes("complet") ||
      this.viewingPeriodDescription.includes("latest 0 chapters") ||
      this.isOneShot
    );
  }

  private get isOnHiatus(): boolean {
    return this.nonAppearanceInfo.toLowerCase().includes("on a hiatus");
  }

  toSourceManga(): SourceManga {
    const authors = this.title?.author?.split("/");

    return {
      mangaId: this.title?.titleId.toString() ?? "",
      mangaInfo: {
        thumbnailUrl: this.title?.portraitImageUrl ?? "",
        synopsis:
          (this.overview ?? "") +
          (this.viewingPeriodDescription
            ? `\n\n${this.viewingPeriodDescription}`
            : ""),
        primaryTitle: this.title?.name ?? "",
        secondaryTitles: [],
        contentRating: ContentRating.EVERYONE,
        status: this.isCompleted
          ? "Completed"
          : this.isOnHiatus
            ? "On hiatus"
            : "Ongoing",
        artist: authors ? authors[1]?.trimStart() : (this.title?.author ?? ""),
        author: authors ? authors[0]?.trimEnd() : (this.title?.author ?? ""),
        tagGroups: [],
      },
    };
  }
}

class Chapter {
  chapterId: number;
  name: string;
  subTitle?: string;
  startTimeStamp: number;

  constructor(
    chapterId: number,
    name: string,
    startTimeStamp: number,
    subTitle?: string,
  ) {
    this.chapterId = chapterId;
    this.name = name;
    this.startTimeStamp = startTimeStamp;
    this.subTitle = subTitle;
  }

  public get isExpired(): boolean {
    return this.subTitle == null;
  }

  toSChapter(sourceManga: SourceManga): SourceChapter {
    const chapNum = parseFloat(
      this.name.slice(this.name.lastIndexOf("#") + 1),
    );

    return {
      chapterId: this.chapterId.toString(),
      sourceManga,
      langCode: "en",
      title: this.subTitle ?? this.name,
      chapNum: isNaN(chapNum) ? 0 : chapNum,
      sortingIndex: isNaN(chapNum) ? -1 : chapNum,
      publishDate: new Date(this.startTimeStamp * 1000),
    };
  }
}

/*
 * Minimal protobuf reader for the current MANGA Plus API.
 *
 * We only decode the fields used by this extension.
 */
class ProtoReader {
  private readonly data: Uint8Array;
  private pos = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    this.data =
      buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  get done(): boolean {
    return this.pos >= this.data.length;
  }

  uint(): number {
    let value = 0;
    let multiplier = 1;

    while (this.pos < this.data.length) {
      const byte = this.data[this.pos++] ?? 0;
      value += (byte & 0x7f) * multiplier;

      if ((byte & 0x80) === 0) return value;

      multiplier *= 128;

      if (multiplier > Number.MAX_SAFE_INTEGER) {
        throw new Error("Invalid protobuf varint");
      }
    }

    throw new Error("Unexpected end of protobuf response");
  }

  tag(): { field: number; wire: number } {
    const tag = this.uint();

    return {
      field: Math.floor(tag / 8),
      wire: tag & 7,
    };
  }

  bytes(): Uint8Array {
    const length = this.uint();
    const end = this.pos + length;

    if (end > this.data.length) {
      throw new Error("Invalid protobuf length");
    }

    const value = this.data.subarray(this.pos, end);
    this.pos = end;
    return value;
  }

  string(): string {
    return decodeUtf8(this.bytes());
  }

  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.uint();
        return;

      case 1:
        this.pos += 8;
        break;

      case 2: {
        const length = this.uint();
        this.pos += length;
        break;
      }

      case 5:
        this.pos += 4;
        break;

      default:
        throw new Error(`Unsupported protobuf wire type: ${wire}`);
    }

    if (this.pos > this.data.length) {
      throw new Error("Invalid protobuf response");
    }
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = "";

  for (let i = 0; i < bytes.length; i++) {
    const first = bytes[i] ?? 0;

    if (first < 0x80) {
      result += String.fromCharCode(first);
      continue;
    }

    if ((first & 0xe0) === 0xc0) {
      const second = bytes[++i] ?? 0;
      const code = ((first & 0x1f) << 6) | (second & 0x3f);
      result += String.fromCharCode(code);
      continue;
    }

    if ((first & 0xf0) === 0xe0) {
      const second = bytes[++i] ?? 0;
      const third = bytes[++i] ?? 0;
      const code =
        ((first & 0x0f) << 12) |
        ((second & 0x3f) << 6) |
        (third & 0x3f);
      result += String.fromCharCode(code);
      continue;
    }

    if ((first & 0xf8) === 0xf0) {
      const second = bytes[++i] ?? 0;
      const third = bytes[++i] ?? 0;
      const fourth = bytes[++i] ?? 0;

      let code =
        ((first & 0x07) << 18) |
        ((second & 0x3f) << 12) |
        ((third & 0x3f) << 6) |
        (fourth & 0x3f);

      code -= 0x10000;

      result += String.fromCharCode(
        0xd800 + (code >> 10),
        0xdc00 + (code & 0x3ff),
      );
    }
  }

  return result;
}

function languageFromCode(code: number): Language {
  switch (code) {
    case 1:
      return Language.SPANISH;
    case 2:
      return Language.FRENCH;
    case 3:
      return Language.INDONESIAN;
    case 4:
      return Language.PORTUGUESE_BR;
    case 5:
      return Language.RUSSIAN;
    case 6:
      return Language.THAI;
    case 9:
      return Language.VIETNAMESE;
    default:
      return Language.ENGLISH;
  }
}

function decodeTitle(data: Uint8Array): Title {
  const reader = new ProtoReader(data);

  let titleId = 0;
  let name = "";
  let author: string | undefined;
  let portraitImageUrl = "";
  let language = Language.ENGLISH;

  while (!reader.done) {
    const { field, wire } = reader.tag();

    switch (field) {
      case 1:
        titleId = reader.uint();
        break;
      case 2:
        name = reader.string();
        break;
      case 3:
        author = reader.string();
        break;
      case 4:
        portraitImageUrl = reader.string();
        break;
      case 7:
        language = languageFromCode(reader.uint());
        break;
      default:
        reader.skip(wire);
    }
  }

  const title = new Title(
    titleId,
    name,
    portraitImageUrl,
    "",
    author,
  );

  title.language = language;

  return title;
}

function decodeChapter(data: Uint8Array): Chapter {
  const reader = new ProtoReader(data);

  let chapterId = 0;
  let name = "";
  let subTitle: string | undefined;
  let startTimeStamp = 0;

  while (!reader.done) {
    const { field, wire } = reader.tag();

    switch (field) {
      case 2:
        chapterId = reader.uint();
        break;
      case 3:
        name = reader.string();
        break;
      case 4:
        subTitle = reader.string();
        break;
      case 6:
        startTimeStamp = reader.uint();
        break;
      default:
        reader.skip(wire);
    }
  }

  return new Chapter(chapterId, name, startTimeStamp, subTitle);
}

function decodeChapterGroup(data: Uint8Array): {
  first: Chapter[];
  last: Chapter[];
} {
  const reader = new ProtoReader(data);

  const first: Chapter[] = [];
  const last: Chapter[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if (field === 2 && wire === 2) {
      first.push(decodeChapter(reader.bytes()));
    } else if (field === 4 && wire === 2) {
      last.push(decodeChapter(reader.bytes()));
    } else {
      reader.skip(wire);
    }
  }

  return { first, last };
}

function decodeTitleDetailView(data: Uint8Array): TitleDetailView {
  const reader = new ProtoReader(data);
  const result = new TitleDetailView();

  while (!reader.done) {
    const { field, wire } = reader.tag();

    switch (field) {
      case 1:
        result.title = decodeTitle(reader.bytes());
        break;

      case 3:
        result.overview = reader.string();
        break;

      case 7:
        result.viewingPeriodDescription = reader.string();
        break;

      case 8:
        result.nonAppearanceInfo = reader.string();
        break;

      case 28: {
        const group = decodeChapterGroup(reader.bytes());
        result.firstChapterList.push(...group.first);
        result.lastChapterList.push(...group.last);
        break;
      }

      default:
        reader.skip(wire);
    }
  }

  return result;
}

function decodeAllTitles(data: Uint8Array): AllTitlesViewV3 {
  const reader = new ProtoReader(data);
  const titles: { title: Title }[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if (field === 3 && wire === 2) {
      const entry = new ProtoReader(reader.bytes());
      let title: Title | undefined;

      while (!entry.done) {
        const tag = entry.tag();

        if (tag.field === 2 && tag.wire === 2) {
          title = decodeTitle(entry.bytes());
        } else {
          entry.skip(tag.wire);
        }
      }

      if (title) titles.push({ title });
    } else {
      reader.skip(wire);
    }
  }

  return { titles };
}

function decodeRanking(data: Uint8Array): TitleRankingView {
  const reader = new ProtoReader(data);
  const rankedTitles: { titles: Title[] }[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if (field === 3 && wire === 2) {
      const groupReader = new ProtoReader(reader.bytes());
      const titles: Title[] = [];

      while (!groupReader.done) {
        const tag = groupReader.tag();

        if (tag.field === 2 && tag.wire === 2) {
          titles.push(decodeTitle(groupReader.bytes()));
        } else {
          groupReader.skip(tag.wire);
        }
      }

      rankedTitles.push({ titles });
    } else {
      reader.skip(wire);
    }
  }

  return { rankedTitles };
}

function decodeUpdatedTitle(data: Uint8Array): UpdatedTitle {
  const reader = new ProtoReader(data);
  let latestChapter: { title?: Title } | undefined;

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if (field === 3 && wire === 2) {
      const chapterReader = new ProtoReader(reader.bytes());
      let title: Title | undefined;

      while (!chapterReader.done) {
        const tag = chapterReader.tag();

        if (tag.field === 1 && tag.wire === 2) {
          title = decodeTitle(chapterReader.bytes());
        } else {
          chapterReader.skip(tag.wire);
        }
      }

      latestChapter = { title };
    } else {
      reader.skip(wire);
    }
  }

  return { latestChapter };
}

function decodeWebHome(data: Uint8Array): WebHomeViewV4 {
  const reader = new ProtoReader(data);
  const groups: { titles: UpdatedTitle[] }[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if (field === 2 && wire === 2) {
      const groupReader = new ProtoReader(reader.bytes());
      const titles: UpdatedTitle[] = [];

      while (!groupReader.done) {
        const tag = groupReader.tag();

        if (tag.field === 2 && tag.wire === 2) {
          titles.push(decodeUpdatedTitle(groupReader.bytes()));
        } else {
          groupReader.skip(tag.wire);
        }
      }

      groups.push({ titles });
    } else {
      reader.skip(wire);
    }
  }

  return { groups };
}

function decodeMangaPage(data: Uint8Array): MangaPage {
  const reader = new ProtoReader(data);

  let imageUrl = "";
  let encryptionKey: string | undefined;

  while (!reader.done) {
    const { field, wire } = reader.tag();

    switch (field) {
      case 1:
        imageUrl = reader.string();
        break;
      case 5:
        encryptionKey = reader.string();
        break;
      default:
        reader.skip(wire);
    }
  }

  return { imageUrl, encryptionKey };
}

function decodeMangaViewer(data: Uint8Array): MangaViewer {
  const reader = new ProtoReader(data);

  const pages: MangaPlusPage[] = [];
  let titleId: number | undefined;
  let viewToken: string | undefined;

  while (!reader.done) {
    const { field, wire } = reader.tag();

    switch (field) {
      case 1: {
        const pageReader = new ProtoReader(reader.bytes());
        let mangaPage: MangaPage | undefined;

        while (!pageReader.done) {
          const tag = pageReader.tag();

          if (tag.field === 1 && tag.wire === 2) {
            mangaPage = decodeMangaPage(pageReader.bytes());
          } else {
            pageReader.skip(tag.wire);
          }
        }

        pages.push({ mangaPage });
        break;
      }

      case 9:
        titleId = reader.uint();
        break;

      case 19:
        viewToken = reader.string();
        break;

      default:
        reader.skip(wire);
    }
  }

  return {
    pages,
    titleId,
    viewToken,
  };
}

function decodeError(data: Uint8Array): ErrorResult {
  const reader = new ProtoReader(data);
  const popups: Popup[] = [];

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if ((field === 2 || field === 3) && wire === 2) {
      const popupReader = new ProtoReader(reader.bytes());
      let body = "";

      while (!popupReader.done) {
        const tag = popupReader.tag();

        if (tag.field === 2 && tag.wire === 2) {
          body = popupReader.string();
        } else {
          popupReader.skip(tag.wire);
        }
      }

      popups.push({
        body,
        language:
          field === 3 ? Language.SPANISH : Language.ENGLISH,
      });
    } else {
      reader.skip(wire);
    }
  }

  return { popups };
}

function decodeSuccess(data: Uint8Array): SuccessResult {
  const reader = new ProtoReader(data);
  const result: SuccessResult = {};

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if (wire !== 2) {
      reader.skip(wire);
      continue;
    }

    switch (field) {
      case 8:
        result.titleDetailView = decodeTitleDetailView(reader.bytes());
        break;

      case 10:
        result.mangaViewer = decodeMangaViewer(reader.bytes());
        break;

      case 35:
        result.allTitlesViewV3 = decodeAllTitles(reader.bytes());
        break;

      case 37:
        result.titleRankingView = decodeRanking(reader.bytes());
        break;

      case 38:
        result.webHomeViewV4 = decodeWebHome(reader.bytes());
        break;

      default:
        reader.skip(wire);
    }
  }

  return result;
}

export function decodeMangaPlusResponse(
  buffer: ArrayBuffer,
): MangaPlusResponse {
  const reader = new ProtoReader(buffer);
  const result: MangaPlusResponse = {};

  while (!reader.done) {
    const { field, wire } = reader.tag();

    if (field === 1 && wire === 2) {
      result.success = decodeSuccess(reader.bytes());
    } else if (field === 2 && wire === 2) {
      result.error = decodeError(reader.bytes());
    } else {
      reader.skip(wire);
    }
  }

  return result;
}
