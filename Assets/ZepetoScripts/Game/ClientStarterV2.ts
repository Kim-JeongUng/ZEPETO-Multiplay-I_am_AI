import {ZepetoScriptBehaviour} from 'ZEPETO.Script'
import {ZepetoWorldMultiplay} from 'ZEPETO.World'
import {Room, RoomData} from 'ZEPETO.Multiplay'
import {Player, State, Vector3} from 'ZEPETO.Multiplay.Schema'
import {
    CharacterState,
    SpawnInfo,
    ZepetoPlayers,
    ZepetoPlayer,
    CharacterJumpState,
    ZepetoCharacter
} from 'ZEPETO.Character.Controller'
import * as UnityEngine from "UnityEngine";
import {Random} from 'UnityEngine'
import ZepetoGameCharacter from './ZepetoGameCharacter'


export default class ClientStarterV2 extends ZepetoScriptBehaviour {

    public multiplay: ZepetoWorldMultiplay;
    public room: Room;
    private currentPlayers: Map<string, Player> = new Map<string, Player>();

    private zepetoPlayer: ZepetoPlayer;
    public static instance: ClientStarterV2;

    /* Singleton */
    private Awake() {
        if (ClientStarterV2.instance == null) {
            ClientStarterV2.instance = this;
        } else {
            return;
        }
    }

    private Start() {
        this.multiplay.RoomCreated += (room: Room) => {
            this.room = room;
        };
        this.multiplay.RoomJoined += (room: Room) => {
            room.OnStateChange += this.OnStateChange;
        };
        this.StartCoroutine(this.SendMessageLoop(0.04));
    }

    // Send the local character transform to the server at the scheduled Interval Time.
    private* SendMessageLoop(tick: number) {
        while (true) {
            yield new UnityEngine.WaitForSeconds(tick);

            if (this.room != null && this.room.IsConnected) {
                const hasPlayer = ZepetoPlayers.instance.HasPlayer(this.room.SessionId);
                if (hasPlayer) {
                    const character = ZepetoPlayers.instance.GetPlayer(this.room.SessionId).character;
                    this.SendTransform(character.transform);
                    this.SendState(character.CurrentState);
                }
            }
        }
    }

    private OnStateChange(state: State, isFirst: boolean) {

        // When the first OnStateChange event is received, a full state snapshot is recorded.
        if (isFirst) {

            // [CharacterController] (Local) Called when the Player instance is fully loaded in Scene
            ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
                const myPlayer = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer;
                this.zepetoPlayer = myPlayer;
            });

            // [CharacterController] (Local) Called when the Player instance is fully loaded in Scene
            ZepetoPlayers.instance.OnAddedPlayer.AddListener((sessionId: string) => {
                if(sessionId.includes("AI_"))
                    return
                
                const isLocal = this.room.SessionId === sessionId;
                if (!isLocal) {
                    const player: Player = this.currentPlayers.get(sessionId);

                    // [RoomState] Called whenever the state of the player instance is updated. 
                    player.OnChange += (changeValues) => this.OnUpdatePlayer(sessionId, player);
                }
                const nowJoinPlayer = ZepetoPlayers.instance.GetPlayer(sessionId).character;
                nowJoinPlayer.tag = "Player";
                nowJoinPlayer.name = sessionId;
                let zepetoGameCharacter = nowJoinPlayer.transform.gameObject.AddComponent<ZepetoGameCharacter>();
                zepetoGameCharacter.userID = this.currentPlayers.get(sessionId).zepetoUserId;
                zepetoGameCharacter.sessionID = sessionId;
            });
        }

        let join = new Map<string, Player>();
        let leave = new Map<string, Player>(this.currentPlayers);

        state.players.ForEach((sessionId: string, player: Player) => {
            if (!this.currentPlayers.has(sessionId)) {
                join.set(sessionId, player);
            }
            leave.delete(sessionId);
        });

        // [RoomState] Create a player instance for players that enter the Room
        join.forEach((player: Player, sessionId: string) => this.OnJoinPlayer(sessionId, player));

        // [RoomState] Remove the player instance for players that exit the room
        leave.forEach((player: Player, sessionId: string) => this.OnLeavePlayer(sessionId, player));
    }

    private OnJoinPlayer(sessionId: string, player: Player) {
        console.log(`[OnJoinPlayer] players - sessionId : ${sessionId}`);
        this.currentPlayers.set(sessionId, player);

        const spawnInfo = new SpawnInfo();
        const position = this.ParseVector3(player.transform.position);
        const rotation = this.ParseVector3(player.transform.rotation);
        /*const position = new UnityEngine.Vector3(Random.Range(-25, 25), 0, Random.Range(-25, 25));
        const rotation = new UnityEngine.Vector3(0, Random.Range(-180, 180), 0);*/
        spawnInfo.position = position;
        spawnInfo.rotation = UnityEngine.Quaternion.Euler(rotation);
        const isLocal = this.room.SessionId === player.sessionId;
        //ZepetoPlayers.instance.CreatePlayerWithUserId(sessionId, player.zepetoUserId, spawnInfo, isLocal);
        ZepetoPlayers.instance.CreatePlayerWithUserId(sessionId, "", spawnInfo, isLocal);
    }

    private OnLeavePlayer(sessionId: string, player: Player) {
        console.log(`[OnRemove] players - sessionId : ${sessionId}`);
        this.currentPlayers.delete(sessionId);
        ZepetoPlayers.instance.RemovePlayer(sessionId);
    }

    private OnUpdatePlayer(sessionId: string, player: Player) {

        const position = this.ParseVector3(player.transform.position);

        const zepetoPlayer = ZepetoPlayers.instance.GetPlayer(sessionId);

        var moveDir = UnityEngine.Vector3.op_Subtraction(position, zepetoPlayer.character.transform.position);
        moveDir = new UnityEngine.Vector3(moveDir.x, 0, moveDir.z);

        if (moveDir.magnitude < 0.05) {
            if (player.state === CharacterState.MoveTurn)
                return;
            zepetoPlayer.character.StopMoving();
        } else {
            zepetoPlayer.character.MoveContinuously(moveDir);
        }

        if (player.state === CharacterState.Jump) {
            if (zepetoPlayer.character.CurrentState !== CharacterState.Jump) {
                zepetoPlayer.character.Jump();
            }
            if (player.subState === CharacterJumpState.JumpDouble) {
                zepetoPlayer.character.DoubleJump();
            }
        }
    }

    private SendTransform(transform: UnityEngine.Transform) {
        const data = new RoomData();

        const pos = new RoomData();
        pos.Add("x", transform.localPosition.x);
        pos.Add("y", transform.localPosition.y);
        pos.Add("z", transform.localPosition.z);
        data.Add("position", pos.GetObject());

        const rot = new RoomData();
        rot.Add("x", transform.localEulerAngles.x);
        rot.Add("y", transform.localEulerAngles.y);
        rot.Add("z", transform.localEulerAngles.z);
        data.Add("rotation", rot.GetObject());
        this.room.Send("onChangedTransform", data.GetObject());
    }

    private SendState(state: CharacterState) {
        const data = new RoomData();
        data.Add("state", state);
        if (state === CharacterState.Jump) {
            data.Add("subState", this.zepetoPlayer.character.MotionV2.CurrentJumpState);
        }
        this.room.Send("onChangedState", data.GetObject());
    }

    private ParseVector3(vector3: Vector3): UnityEngine.Vector3 {
        return new UnityEngine.Vector3
        (
            vector3.x,
            vector3.y,
            vector3.z
        );
    }
}
