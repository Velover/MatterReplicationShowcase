import { AnyEntity, component, Entity, Loop, World } from "@rbxts/matter";
import { RunService, Workspace } from "@rbxts/services";
import {
	FunctionTools,
	InstanceTools,
	NetworkingTools,
} from "@rbxts/tool_pack";

namespace MatterTest {
	const added_replicate_event =
		NetworkingTools.DefineRemoteEvent<
			(id: AnyEntity, position: Vector3) => void
		>("ReplicateAdded");

	const removed_replicate_event =
		NetworkingTools.DefineRemoteEvent<(id: AnyEntity) => void>(
			"ReplicateRemoved",
		);

	const position_changed_replicate_event =
		NetworkingTools.DefineRemoteEvent<
			(id: AnyEntity, position: Vector3) => void
		>("ReplicateChanged");

	const client_replication_ready_event =
		NetworkingTools.DefineRemoteEvent("Ready");

	const replicate_all_event =
		NetworkingTools.DefineRemoteEvent<
			(data: [id: AnyEntity, position: Vector3][]) => void
		>("ReplicateAll");

	const position_component = component<{
		Position: Vector3;
	}>();
	const instance_component = component<{
		Instance: BasePart;
	}>();
	const to_remove_component = component();

	const world = new World();
	const loop = new Loop(world);

	function ReplicateServerSystem(world: World) {
		for (const [entity_id, data] of world.queryChanged(position_component)) {
			if (data.old === undefined) {
				added_replicate_event.FireAllClients(entity_id, data.new!.Position);
			} else if (data.new === undefined) {
				removed_replicate_event.FireAllClients(entity_id);
			} else {
				position_changed_replicate_event.FireAllClients(
					entity_id,
					data.new!.Position,
				);
			}
		}
	}

	function CreateInstance() {
		return InstanceTools.Create("Part", {
			Size: Vector3.one,
			Anchored: true,
			Parent: Workspace,
		});
	}

	function PositionChangedClientSystem(world: World) {
		for (const [entity_id, data] of world.queryChanged(position_component)) {
			if (data.old === undefined) {
				world.insert(
					entity_id,
					instance_component({
						Instance: CreateInstance(),
					}),
				);
			} else if (data.new === undefined) {
				//cannot do enything :shrug:
			} else {
				const instance_value = world.get(entity_id, instance_component);
				if (instance_value === undefined) continue;
				instance_value.Instance.Position = data.new.Position;
			}
		}
	}

	function RemoveClientSystem(world: World) {
		for (const [entity_id] of world.query(to_remove_component)) {
			const instance_value = world.get(entity_id, instance_component);
			instance_value?.Instance.Destroy();
			world.despawn(entity_id);
		}
	}

	///////////----------------------start
	const server_to_client_entity_refference = new Map<AnyEntity, AnyEntity>();
	FunctionTools.ExecuteIfClient(() => {
		client_replication_ready_event.FireServer();
		function CreateEntity(server_entity: AnyEntity, position: Vector3) {
			print("Created client", position);
			const client_entity = world.spawn(
				position_component({ Position: position }),
			);
			server_to_client_entity_refference.set(server_entity, client_entity);
		}

		function RemoveEntity(server_entity: AnyEntity) {
			print("Removed client");
			const client_entity =
				server_to_client_entity_refference.get(server_entity);
			if (client_entity === undefined) return;
			world.insert(client_entity, to_remove_component());
			server_to_client_entity_refference.delete(server_entity);
		}

		function EditEntity(server_entity: AnyEntity, position: Vector3) {
			print("Edited entity", position);
			const client_entity =
				server_to_client_entity_refference.get(server_entity);
			if (client_entity === undefined) return;
			const position_value = world.get(client_entity, position_component);
			if (position_value === undefined) return;
			world.insert(
				client_entity,
				position_value.patch({
					Position: position,
				}),
			);
		}

		replicate_all_event.OnClientEvent.Connect(
			(data: [id: AnyEntity, position: Vector3][]) => {
				for (const [server_entity, position] of data) {
					CreateEntity(server_entity, position);
				}
			},
		);

		added_replicate_event.OnClientEvent.Connect(CreateEntity);
		removed_replicate_event.OnClientEvent.Connect(RemoveEntity);
		position_changed_replicate_event.OnClientEvent.Connect(EditEntity);
	});

	FunctionTools.ExecuteIfServer(() => {
		client_replication_ready_event.OnServerEvent.Connect((player) => {
			const data: [id: AnyEntity, position: Vector3][] = [];
			for (const [id, position_value] of world.query(position_component)) {
				data.push([id, position_value.Position]);
			}
			replicate_all_event.FireClient(player, data);
		});
	});

	////////////////////////////////////// ---------------scheduling systems
	FunctionTools.ExecuteIfServer(() => {
		loop.scheduleSystems([ReplicateServerSystem]);
	});

	FunctionTools.ExecuteIfClient(() => {
		//order sometimes matters 🤔
		loop.scheduleSystems([RemoveClientSystem, PositionChangedClientSystem]);
	});

	loop.begin({
		default: RunService.Heartbeat,
	});

	//Test
	FunctionTools.ExecuteIfServer(async () => {
		task.wait(3);
		const entt_1 = world.spawn(
			position_component({
				Position: Vector3.one,
			}),
		);
		task.wait(2);
		const entt_2 = world.spawn(
			position_component({
				Position: new Vector3(0, 10, 0),
			}),
		);
		world.insert(
			entt_1,
			world.get(entt_1, position_component)!.patch({
				Position: new Vector3(10, 10, 0),
			}),
		);

		task.wait(1);
		world.despawn(entt_2);
	});
}
