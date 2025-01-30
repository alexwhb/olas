import { atom } from 'jotai';
import { PostMedia } from './MediaPreview';

export const stepAtom = atom(0);

export const wantsToPublishAtom = atom(false);

/**
 * Selected media
 */
export const selectedMediaAtom = atom<PostMedia[], [PostMedia[]], void>([], (get, set, media: PostMedia[]) =>
    set(selectedMediaAtom, media)
);

export const selectingMediaAtom = atom(false);

export const uploadErrorAtom = atom<string | null, [string | null], void>(null, (get, set, error: string | null) =>
    set(uploadErrorAtom, error)
);
export type Location = {
    latitude: number;
    longitude: number;
};

export type PostMetadata = {
    caption: string;
    tags?: string[];
    expiration?: number;
    boost?: boolean;
    removeLocation?: boolean;
    location?: Location;
    group?: {
        groupId: string;
        relays: string[];
    }
};
export const metadataAtom = atom<PostMetadata, [PostMetadata], void>({ caption: '' }, (get, set, metadata: PostMetadata) =>
    set(metadataAtom, metadata)
);

export const multiImageModeAtom = atom(false);

export const uploadingAtom = atom(false);
