// ナビゲーション型定義

export interface MediaItem {
  uri: string;
  type: 'image' | 'video';
}

/** 公開完了時の結果 */
export interface PublishResult {
  shortId: string;
  pageUrl: string;
  thumbnailUrl: string;
}

export type RootStackParamList = {
  Main: undefined;
  Camera: undefined;
  CameraGallery: undefined;
  Publishing: { signedUris: string[]; address: string };
  Preview: { contentIds: string[]; thumbnailUrl?: string };
  Registration: { signedUris: string[] };
  InstagramShare: { pageUrl: string; shortId: string; thumbnailUrl: string };
  TwitterShare: { pageUrl: string; shortId: string; thumbnailUrl: string };
};

export type GalleryStackParamList = {
  Gallery: undefined;
  Settings: undefined;
};

export type TabParamList = {
  PublishedTab: undefined;
  CameraTab: undefined;
  DeviceGalleryTab: undefined;
};
