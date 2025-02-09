import { timeZero } from "@/app/_layout";
import { usePubkeyBlacklist } from "@/hooks/blacklist";
import { useReactionsStore } from "@/stores/reactions";
import NDK, { Hexpubkey, NDKEvent, NDKEventId, NDKFilter, NDKKind, NDKRelaySet, NDKSubscription, NDKSubscriptionCacheUsage, useMuteFilter, useNDK, wrapEvent, useNDKCurrentUser } from "@nostr-dev-kit/ndk-mobile";
import { matchFilters, VerifiedEvent } from "nostr-tools";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * An entry in the feed. It ultimately resolves to an event,
 * but it includes reposts and the effective timestamp to use for
 * sorting.
 */
export type FeedEntry = {
    id: string;
    event?: NDKEvent;
    reposts: NDKEvent[];
    timestamp: number;

    /**
     * Used to track when we see an event deletion but we haven't
     * seen the deleted event yet -- we keep the pubkey of the
     * event doing the deletion to check it's the same as the author
     * of the event.
     */
    deletedBy?: Hexpubkey[];

    /**
     * Whether the entry has been deleted.
     */
    deleted?: boolean;
}

/**
 * Handles creating a feed that accounts for reposts, mutes
 * @param filters 
 * @param opts.subId The subscription ID to use for this feed
 * @param dependencies Dependencies to re-run the subscription
 * @returns 
 */
export function useFeedEvents(
    filters: NDKFilter[] | undefined,
    { subId, filterFn, relayUrls }: {
        subId?: string,
        filterFn?: (feedEntry: FeedEntry, index: number) => boolean,
        relayUrls?: string[]
    } = {},
    dependencies = []
) {
    subId ??= 'feed';
    
    const { ndk } = useNDK();

    /**
     * This reference keeps all the events that have been received
     * and that might be rendered (after filtering)
     */
    const feedEntriesRef = useRef(new Map<NDKEventId, FeedEntry>());
    
    /**
     * Tracks the event Ids we have already processed, note that this includes
     * IDs that don't are not feed entries (like reposts), that's why we need
     * to keep track of them separately.
     */
    const addedEventIds = useRef(new Set());

    const subscription = useRef<NDKSubscription | undefined>(undefined);
    const eosed = useRef(false);

    /**
     * Entries are the feed entries that the caller will see.
     */
    const [entries, setEntries] = useState<FeedEntry[]>([]);

    /**
     * newEntries are feed entries that arrived later than the feed
     * was rendered; they shouldn't be rendered but rather an indicator
     * shown that there are newer items to be displayed.
     */
    const [newEntries, setNewEntries] = useState<FeedEntry[]>([]);

    const pubkeyBlacklist = usePubkeyBlacklist();
    const isMutedEvent = useMuteFilter();

    // const followSet = useMemo(() => {
    //     const set = new Set(follows);
    //     if (currentUser) set.add(currentUser.pubkey)
    //     return set;
    // }, [currentUser?.pubkey, follows?.length])

    /**
     * This modifies entries in a way that the user of the hook will receive the
     * update in the feed of entries to render
     */
    const updateEntries = useCallback((reason: string) => {
        const time = Date.now() - subscriptionStartTime.current;
        // console.log(`[${Date.now() - timeZero}ms]`, `[FEED HOOK ${time}ms] updating entries, we start with`, entries.length, { reason });
        let newEntries = Array.from(feedEntriesRef.current.values())
            .filter((entry) => !!entry.event)
            .filter((entry: FeedEntry) => ( !isMutedEvent(entry.event) && !pubkeyBlacklist.has(entry.event?.pubkey) ))
        
        if (filterFn)
            newEntries = newEntries.filter(filterFn);
        
        if (newEntries.length === 0 && entries.length === 0) return;

        newEntries = newEntries.sort((a, b) => b.timestamp - a.timestamp);

        // console.log(`[${Date.now() - timeZero}ms]`, 'setting entries', newEntries.length)
        setEntries(newEntries.slice(0, 300));
        if (newEntries.length > 0) {
            // console.log(`[${Date.now() - timeZero}ms]`, 'emptying new entries', newEntries.length)
            setNewEntries([]);
        }
        
        // console.log(`[${Date.now() - timeZero}ms]`, `[FEED HOOK ${time}ms] updated entries, finished with`, newEntries.length)
    }, [setEntries, setNewEntries, isMutedEvent, filterFn]);

    useEffect(() => {
        if (feedEntriesRef.current.size === 0) return;
        updateEntries('update entries changed');
    }, [updateEntries]);

    // useEffect(() => console.log('set entries changed'), [setEntries])
    // useEffect(() => console.log('set new entries changed'), [setNewEntries])
    // useEffect(() => console.log('is muted event changed'), [isMutedEvent])
    // useEffect(() => console.log('filter fn changed'), [filterFn])

    const highestTimestamp = useRef(-1);

    const addEntry = useCallback((id: string, cb: (currentEntry: FeedEntry) => FeedEntry) => {
        let entry: FeedEntry = feedEntriesRef.current.get(id);
        if (!entry) entry = { id, reposts: [], timestamp: -1 };
        const ret = cb(entry);
        if (!!ret) {
            ret.timestamp = ret.event?.created_at ?? -1;
            feedEntriesRef.current.set(id, ret)

            // if this is the newest timestamp, we haven't timestamped
            // show the new entry
            if (ret.timestamp > highestTimestamp.current) {
                highestTimestamp.current = ret.timestamp;
                updateEntries('new entry');
            }
        }
        return entry;
    }, [updateEntries]);

    const handleContentEvent = useCallback((eventId: string, event: NDKEvent) => {
        const entry = addEntry(eventId, (entry: FeedEntry) => {
            const wrappedEvent = wrapEvent(event);
            const ret = { ...entry, event: wrappedEvent };
            ret.timestamp = event.created_at;
            return ret;
        });

        // if we have already EOSEd, we add to newEntries too
        if (eosed.current) {
            setNewEntries([ entry, ...newEntries ])
        }
    }, [setNewEntries, newEntries, addEntry]);

    /**
     * Adds the repost to the right feed item, whether the item has been
     * processed yet or not.
     */
    const handleRepost = useCallback((event: NDKEvent) => {
        const repostedId = event.tagValue("e");
        if (!repostedId) return;

        addEntry(repostedId, (entry: FeedEntry) => {
            entry.reposts.push(event);
        
            if (!entry.event) {
                try {
                    const payload = JSON.parse(event.content)
                    entry = {
                        id: payload.id,
                        event: new NDKEvent(ndk, payload),
                        reposts: [event],
                        timestamp: event.created_at
                    }
                } catch {
                    entry = undefined;
                }
            }

            return entry;
        });
    }, []);

    const handleBookmark = useCallback((event: NDKEvent) => {
        const bookmarkedId = event.tagValue("e");
        if (!bookmarkedId) return;

        addEntry(bookmarkedId, (entry: FeedEntry) => {
            if (!entry || entry.timestamp < event.created_at) {
                entry ??= { id: bookmarkedId, reposts: [], timestamp: -1 };
                entry.timestamp = event.created_at;
            }
            return entry;
        });
    }, [addEntry]);

    const handleDeletion = useCallback((event: NDKEvent) => {
        for (const deletedId of event.getMatchingTags("e")) {
            const entry = feedEntriesRef.current.get(deletedId[0]);
            if (entry?.event) {
                // check if the pubkey matches
                if (entry.event.pubkey === event.pubkey) {
                    entry.deleted = true;
                }
            } else {
                // we don't have the event, let's just record the deletion
                addEntry(deletedId[0], (entry) => ({ ...entry, deletedBy: [...(entry.deletedBy||[]), event.pubkey ] }));
            }
        }
    }, [addEntry]);

    const handleEvent = useCallback((event: NDKEvent) => {
        const eventId = event.tagId();
        if (addedEventIds.current.has(eventId)) return;
        addedEventIds.current.add(eventId);

        switch (event.kind) {
            case NDKKind.VerticalVideo:
            case NDKKind.HorizontalVideo:
            case NDKKind.Text:
            case NDKKind.Image: return handleContentEvent(eventId, event);
            case NDKKind.GenericRepost: return handleRepost(event);
            case 3006: return handleBookmark(event);
            case NDKKind.EventDeletion: return handleDeletion(event);
        }
    }, [handleContentEvent, handleRepost, handleBookmark, handleDeletion]);

    const handleEose = useCallback(() => {
        eosed.current = true;
        updateEntries('eose');
    }, [updateEntries])

    /**
     * We want to flush the buffer the moment the cache finishes loading, particularly for when
     * we are not connected to relays and there won't be an EOSE coming any time soon.
     */
    const handleCacheEose = useCallback(() => {
        updateEntries('cache-eose');
    }, [updateEntries]);

    const filterExistingEvents = useCallback(() => {
        let changed = false;

        for (const [id, feedEntry] of feedEntriesRef.current) {
            if (!feedEntry.event) continue;
            const keep = feedEntry.event && matchFilters(filters, feedEntry.event.rawEvent() as VerifiedEvent)
            if (!keep) {
                // console.log('filtering out', id)
                feedEntriesRef.current.delete(id)
                addedEventIds.current.delete(id);
                changed = true;
            }
        }

        if (changed) updateEntries('filtering out events');
    }, dependencies);

    const subscriptionStartTime = useRef(0);
    
    useEffect(() => {
        if (!ndk) return;
        if (!filters) return;

        subscriptionStartTime.current = Date.now();

        if (subscription.current) {
            subscription.current.stop();
            subscription.current = null;
            eosed.current = false;
            addedEventIds.current.clear();

            filterExistingEvents()
        }

        let relaySet: NDKRelaySet | undefined = undefined;
        if (relayUrls) {
            relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk);
        }

        // console.log('subscribing to', {dependencies: JSON.stringify(dependencies)}, filters, { subId, relaySet: relaySet?.relayUrls?.join(', ') })
        
        const sub = ndk.subscribe(filters, { groupable: false, skipVerification: true, subId, cacheUnconstrainFilter: [] }, relaySet, false);

        sub.on("event", handleEvent);
        sub.once('eose', handleEose);
        sub.once('cacheEose', handleCacheEose);

        sub.start();
        subscription.current = sub;

        return () => {
            sub.stop();
        }
    }, [ndk, ...dependencies])

    return {
        entries,
        newEntries,
        
        /**
         * When new events arrive after EOSE, they will be collected in the newEntries, this is
         * so that the feed doesn't jump around and instead we can show a "new events received".
         * 
         * The application should call ingestNewEntries when it's ready to render them.
         */
        updateEntries
    };
}

/**
 * This hook receives a list of events that.
 * 
 * We want to monitor for events that are tagging the events in the active slices.
 * 
 * We may keep one or two subscriptions that will be fetching data for the items.
 * 
 * As the user is scrolling down, when they are close to reaching the end of the current slice's index a new
 * subscription is created with the next slice.
 * If the user keeps scrolling down, after a threshold, the previous subscription is closed
 * 
 * @param events: Events to monitor
 * @param closeThreshold Distance to the previous slice at which that subscription is closed.
 * @param sliceSize Sice of the slice
 */
type Slice = {
    start: number;
    end: number;
    sub?: NDKSubscription;
    removeTimeout?: NodeJS.Timeout;
}
export function useFeedMonitor(
    events: NDKEvent[],
    sliceSize = 5
) {
    const { ndk } = useNDK();
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const activeSlices = useRef<Slice[]>([]);
    const currentUser = useNDKCurrentUser();
    const addRelatedEvent = useReactionsStore(s => s.addEvent);

    const sliceToFilter = (slice: Slice): NDKFilter[] => {
        const filterValues: Record<string, string[]> = {};
        events.slice(slice.start, slice.end)
            .flatMap(event => Object.entries(event.filter()))
            .forEach(([key, value]) => {
                filterValues[key] ??= [];
                filterValues[key].push(value[0]);
            });
        return Object.entries(filterValues).map(([key, value]) => ({ [key]: value }));
    }

    // useEffect(() => {
    //     if
    // }, [events[0]?.id, ])

    // const handleEvent = (event: NDKEvent) => {
    //     const id = event.tagId();
    //     const current = 
    //     eventsRef.current.set(id, event);
    // }

    const addSlice = (slice: Slice) => {
        if (slice.end - slice.start < sliceSize) {
            return;
        }
        
        const filters = sliceToFilter(slice);
        slice.sub = ndk.subscribe(filters, {
            cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
            closeOnEose: false,
            groupable: false,
            skipVerification: true,
            subId: `feedmonitor-${slice.start}:${slice.end}`
        }, undefined, {
            onEvent: (event) => addRelatedEvent(event, currentUser?.pubkey)
        });
        activeSlices.current.push(slice);
    }

    const removeSlice = (slice: Slice) => {
        slice.removeTimeout = setTimeout(() => {
            // console.log('removing slice that starts in', slice.start);
            slice.sub.stop();
            activeSlices.current = activeSlices.current.filter(s => s.start !== slice.start);
        }, 500)
    }

    useEffect(() => {
        if (activeIndex === null) return;

        const neededSlices = calcNeededSlices(activeIndex, sliceSize, events.length)

        // go through the slices we have and determine what we should remove
        for (const activeSlice of activeSlices.current) {
            const keep = neededSlices.find(slice => slice.start === activeSlice.start);

            if (!keep) {
                console.log('removing slice', activeSlice.start, 'to', activeSlice.end)
                if (!activeSlice.removeTimeout) removeSlice(activeSlice);
            } else if (activeSlice.removeTimeout) {
                clearTimeout(activeSlice.removeTimeout)
                activeSlice.removeTimeout = null;
            }
        }

        // go through the slices we want and determine what we need to add
        for (const neededSlice of neededSlices) {
            const exists = activeSlices.current.find(slice => slice.start === neededSlice.start);

            if (!exists) addSlice(neededSlice)
        }
        
        // clean up active subs on unmount
        return () => {
            activeSlices.current.forEach(slice => slice.sub.stop());
        }
    }, [activeIndex, events.length < sliceSize]);
    
    return {
        setActiveIndex
    };
}

function calcNeededSlices(
    currentIndex,
    sliceSize,
    totalLength,
) {
    const currentSlice: Slice = {
        start: currentIndex - (currentIndex % sliceSize),
        end: (currentIndex - (currentIndex % sliceSize)) + sliceSize
    };
    const prevSlice: Slice = {
        start: currentSlice.start - sliceSize,
        end: currentSlice.end - sliceSize,
    }
    const nextSlice: Slice = {
        start: currentSlice.start + sliceSize,
        end: currentSlice.end + sliceSize,
    }

    const mapSlices = (slice: Slice): Slice | null => {
        // if we are finishing before 0 then this is an invalid slice
        if (slice.end <= 0) return null;

        // if we are starting after the end this is an invalid slice
        if (slice.start > totalLength) return null;

        if (slice.start < 0) slice.start = 0;
        if (slice.end > totalLength) slice.end = totalLength;

        return slice;
    }

    let slices = [ prevSlice, currentSlice, nextSlice ];
    // console.log('before', slices, { currentIndex, sliceSize, totalLength})
    slices = slices
        .map(mapSlices)
        .filter(slice => slice !== null)
    
    // console.log('calculated slices');
    // slices.forEach(s => console.log(`from ${s.start} to ${s.end}`))
    return slices;
}