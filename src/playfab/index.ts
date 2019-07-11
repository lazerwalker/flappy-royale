import { PlayFabClient, PlayFabEvents } from "PlayFab-sdk"
import { Attire, defaultAttire } from "../attire"
import _ = require("lodash")
import { cache } from "../localCache"
import { titleId } from "../../assets/config/playfabConfig"
import { GameMode } from "../battle/utils/gameMode"
import { APIVersion } from "../constants"
import { allAttireInGame } from "../attire/attireSets"
import { changeSettings, UserSettings, syncedSettingsKeys } from "../user/userManager"
import playfabPromisify, { PlayFabApiMethod } from "./playfabPromisify"
import { firebaseConfig } from "../../assets/config/firebaseConfig"
import { isAppleApp, isAndroidApp } from "../nativeComms/deviceDetection"
import { gameCenterPromise } from "./gameCenter"
import { googlePlayGamesPromise } from "./googlePlay"

export let isLoggedIn: boolean = false

export let loginPromise: Promise<string | undefined>

export let playfabUserId: string | undefined
let playfabEntityKey: PlayFabClientModels.EntityKey | undefined

PlayFabClient.settings.titleId = titleId

const defaultLogin = {
    method: PlayFabClient.LoginWithCustomID,
    payload: {
        TitleId: titleId,
        CreateAccount: true,
        InfoRequestParameters: {
            GetUserData: true,
            GetPlayerProfile: true,
            GetPlayerStatistics: true,
            GetUserInventory: true,
            ProfileConstraints: ({
                ShowAvatarUrl: true,
                ShowDisplayName: true
            } as unknown) as number,

            // These are all marked as "required" but also "false by default". The typings say we need them /shrug
            GetCharacterInventories: false,
            GetCharacterList: false,
            GetTitleData: false,
            GetUserAccountInfo: false,
            GetUserReadOnlyData: false,
            GetUserVirtualCurrency: false
        }
    }
}

export const login = async () => {
    loginPromise = new Promise(async (resolve, reject) => {
        let customAuth = (window as any).playfabAuth

        /** TO DO:
         * A localstorage flag of "have we authed with gamecenter/googleplay?"
         * If no: login with device ID, then link with the thing, then set flag
         * If yes: just log in.
         */
        if (isAppleApp()) {
            // TODO: Should we use a guest game center ID? What does that mean exactly?
            const response = await gameCenterPromise()
            if (response) {
                const result = await playfabPromisify(PlayFabClient.LoginWithGameCenter)({
                    ...defaultLogin,
                    ...response.payload
                })
                resolve(handleLogin(result))
                return
            } else if (customAuth && customAuth.method === "LoginWithIOSDeviceID") {
                // TODO: Go through this flow if Game Center fails on PlayFab's end
                const result = await playfabPromisify(PlayFabClient.LoginWithIOSDeviceID)({
                    ...defaultLogin,
                    ...customAuth.payload
                })
                resolve(handleLogin(result))
                return
            }
        } else if (isAndroidApp()) {
            const response = await googlePlayGamesPromise()
            if (response) {
                const result = await playfabPromisify(PlayFabClient.LoginWithGoogleAccount)({
                    ...defaultLogin,
                    ...response.payload
                })
                resolve(handleLogin(result))
                return
            } else if (customAuth && customAuth.method === "LoginWithAndroidDeviceID") {
                // TODO: Fall back to this flow
                const result = await playfabPromisify(PlayFabClient.LoginWithAndroidDeviceID)({
                    ...defaultLogin,
                    ...customAuth.payload
                })
                resolve(handleLogin(result))
                return
            }
        }

        const result = await playfabPromisify(PlayFabClient.LoginWithCustomID)({
            ...defaultLogin,
            CustomId: cache.getUUID(titleId)
        })
        return handleLogin(result)
    })
    return loginPromise
}

const handleLogin = (
    result: PlayFabModule.IPlayFabSuccessContainer<PlayFabClientModels.LoginResult>
): string | undefined => {
    console.log(result)

    // Grab the data from the server and shove it in the user object
    // TODO: We should eventually merge this more intelligently, in case the user edited their attire while offline
    const payload = result.data.InfoResultPayload
    if (payload) {
        let settings: Partial<UserSettings> = {}
        if (payload.PlayerProfile) {
            settings.name = payload.PlayerProfile.DisplayName
            settings.aesthetics = { attire: avatarUrlToAttire(payload.PlayerProfile.AvatarUrl!) }
        }

        if (payload.UserData && payload.UserData.userSettings && payload.UserData.userSettings.Value) {
            const storedSettings = JSON.parse(payload.UserData.userSettings.Value)
            syncedSettingsKeys.forEach(key => {
                if (!_.isUndefined(storedSettings[key])) {
                    ;(settings as any)[key] = storedSettings[key]
                }
            })
        }

        if (payload.UserInventory) {
            settings.unlockedAttire = payload.UserInventory.map(i => i.ItemId!)
        }

        changeSettings(settings)
    }

    playfabUserId = result.data.PlayFabId

    if (result.data.EntityToken) {
        playfabEntityKey = result.data.EntityToken.Entity
    }

    isLoggedIn = true

    return playfabUserId
}

export const updateName = async (
    name: string
): Promise<PlayFabModule.IPlayFabSuccessContainer<PlayFabClientModels.UpdateUserTitleDisplayNameResult>> => {
    await loginPromise
    return playfabPromisify(PlayFabClient.UpdateUserTitleDisplayName)({ DisplayName: name })
}

export const playedGame = async (data: {
    mode: GameMode
    score: number
    flaps: number
    won: boolean
    winStreak?: number
    birdsPast?: number
}) => {
    let stats = [
        {
            StatisticName: "TotalGamesPlayed",
            Value: 1
        },
        {
            StatisticName: "Score",
            Value: data.score
        },
        {
            StatisticName: "Flaps",
            Value: data.flaps
        }
    ]

    if (data.score === 0) {
        stats.push({
            StatisticName: "FirstPipeFails",
            Value: 1
        })
    }

    if (data.won) {
        stats.push({
            StatisticName: "RoyaleGamesWon",
            Value: 1
        })

        if (data.winStreak) {
            stats.push({
                StatisticName: "RoyaleWinStreak",
                Value: data.winStreak!
            })
        }
    }

    if (data.mode === GameMode.Trial) {
        stats.push({
            StatisticName: "DailyTrial",
            Value: data.score
        })
        stats.push({
            StatisticName: `DailyTrial-${APIVersion}`,
            Value: data.score
        })
    } else if (data.mode === GameMode.Royale) {
        stats.push({
            StatisticName: "RoyaleGamesPlayed",
            Value: 1
        })
    }

    if (data.birdsPast) {
        stats.push({
            StatisticName: "BirdsPast",
            Value: data.birdsPast
        })
    }

    const Statistics = stats
    return await playfabPromisify(PlayFabClient.UpdatePlayerStatistics)({ Statistics })
}

export const updateAttire = async (attire: Attire[], oldAttire: Attire[]) => {
    await loginPromise

    const response = await fetch(`https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/updateAttire`, {
        method: "POST",
        body: JSON.stringify({
            playfabId: playfabUserId,
            attireIds: attire.map(a => a.id)
        })
    })

    if (!response.ok) {
        console.log("Bad attire!")
        changeSettings({ aesthetics: { attire: oldAttire } })
    }
}

export const updateUserSettings = async (settings: UserSettings) => {
    await loginPromise

    let delta: any = {}
    syncedSettingsKeys.forEach(key => {
        delta[key] = (settings as any)[key]
    })

    return await playfabPromisify(PlayFabClient.UpdateUserData)({
        Data: { userSettings: JSON.stringify(delta) }
    })
}

export const event = async (name: string, params: any) => {
    await loginPromise

    PlayFabClient.WritePlayerEvent(
        {
            EventName: name,
            Body: params
        },
        (err: any, _: any) => {
            if (err) {
                console.log("Error writing analytics", err)
            }
        }
    )
}

export const writeScreenTrackingEvents = async (events: PlayFabEventsModels.EventContents[]) => {
    await loginPromise
    events.forEach(e => {
        if (!e.Entity && playfabEntityKey) {
            e.Entity = playfabEntityKey
        }

        if (!e.Payload.UserID) {
            e.Payload.UserID = playfabUserId
        }
    })

    return await playfabPromisify(PlayFabEvents.WriteEvents)({ Events: events })
}

// LEADERBOARDS

export const getTrialLobbyLeaderboard = async (): Promise<Leaderboard> => {
    await loginPromise

    const results = await asyncGetLeaderboard({
        StatisticName: `DailyTrial-${APIVersion}`,
        StartPosition: 0,
        MaxResultsCount: 100
    })
    console.log(results)

    const player = results.find(l => l.userId === playfabUserId)

    return { results, player }
}

export const getTrialDeathLeaderboard = async (): Promise<Leaderboard> => {
    await loginPromise

    let twoResults = await Promise.all([
        asyncGetLeaderboard({
            StatisticName: `DailyTrial-${APIVersion}`,
            StartPosition: 0,
            MaxResultsCount: 3
        }),

        asyncGetLeaderboardAroundPlayer({
            StatisticName: `DailyTrial-${APIVersion}`,
            MaxResultsCount: 3
        })
    ])

    const flattened = _.flatten(twoResults)
    const deduped = _.uniqBy(flattened, "position") // In case the user is in the top 3! this is rare enough we can spare the extra network call

    const player = deduped.find(l => l.userId === playfabUserId)

    return { results: deduped, player }
}

export interface Leaderboard {
    results: LeaderboardResult[]
    player?: LeaderboardResult
}

export interface LeaderboardResult {
    name: string
    attire: Attire[]
    position: number
    score: number
    userId: string
}

const convertPlayFabLeaderboardData = (entry: PlayFabClientModels.PlayerLeaderboardEntry): LeaderboardResult => {
    return {
        name: entry.Profile!.DisplayName!,
        attire: avatarUrlToAttire(entry.Profile!.AvatarUrl!),
        position: entry.Position,
        score: entry.StatValue,
        userId: entry.PlayFabId!
    }
}

const asyncGetLeaderboard = async (opts: PlayFabClientModels.GetLeaderboardRequest): Promise<LeaderboardResult[]> => {
    const defaultOpts = {
        ProfileConstraints: ({
            ShowAvatarUrl: true,
            ShowDisplayName: true
        } as unknown) as number // sigh, the PlayFab TS typings are wrong
    }

    const result = await playfabPromisify(PlayFabClient.GetLeaderboard)({ ...defaultOpts, ...opts })
    if (!result.data.Leaderboard) {
        return []
    } else {
        return result.data.Leaderboard.map(convertPlayFabLeaderboardData)
    }
}

const asyncGetLeaderboardAroundPlayer = async (
    opts: PlayFabClientModels.GetLeaderboardAroundPlayerRequest
): Promise<LeaderboardResult[]> => {
    const defaultOpts = {
        ProfileConstraints: ({
            ShowAvatarUrl: true,
            ShowDisplayName: true
        } as unknown) as number // sigh, the PlayFab TS typings are wrong
    }

    const result = await playfabPromisify(PlayFabClient.GetLeaderboardAroundPlayer)({ ...defaultOpts, ...opts })
    if (!result.data.Leaderboard) {
        return []
    } else {
        return result.data.Leaderboard.map(convertPlayFabLeaderboardData)
    }
}

const attireMap = _.keyBy(allAttireInGame, "id")
export const avatarUrlToAttire = (url: string): Attire[] => {
    if (!url) return [defaultAttire]
    const keys = url.split(",")
    if (keys.length === 0) {
        return [defaultAttire]
    }
    return keys.map(key => attireMap[key]).filter(a => !_.isUndefined(a))
}
