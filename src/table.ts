import type { DynamoDBDocument } from "@aws-sdk/lib-dynamodb";
import { ExpressionBuilder } from "./builders/expression-builder";
import { PutBuilder } from "./builders/put-builder";
import { QueryBuilder } from "./builders/query-builder";
import { UpdateBuilder } from "./builders/update-builder";
import { DynamoService } from "./dynamo/dynamo-service";
import type {
	FilterCondition,
	PrimaryKey,
	TableIndexConfig,
} from "./builders/operators";
import type {
	PrimaryKeyWithoutExpression,
	BatchWriteOperation,
	DynamoOperation,
	DynamoBatchWriteOperation,
	DynamoDeleteOperation,
	DynamoTransactOperation,
} from "./dynamo/dynamo-types";

export class Table {
	private readonly dynamoService: DynamoService;
	private readonly expressionBuilder: ExpressionBuilder;
	private readonly indexes: Record<string, TableIndexConfig>;

	constructor({
		client,
		tableName,
		tableIndexes,
		expressionBuilder,
	}: {
		client: DynamoDBDocument;
		tableName: string;
		tableIndexes: Record<string, TableIndexConfig>;
		expressionBuilder?: ExpressionBuilder;
	}) {
		this.dynamoService = new DynamoService(client, tableName);
		this.expressionBuilder = expressionBuilder ?? new ExpressionBuilder();
		this.indexes = tableIndexes;
	}

	getIndexConfig(indexName?: string): TableIndexConfig {
		if (!indexName) {
			return this.indexes.primary;
		}

		if (this.indexes[indexName]) {
			return this.indexes[indexName];
		}

		throw new Error(`Index ${indexName} does not exist`);
	}

	put(item: Record<string, unknown>): PutBuilder {
		return new PutBuilder(item, this.expressionBuilder, (operation) =>
			this.executeOperation(operation),
		);
	}

	update(
		key: PrimaryKeyWithoutExpression,
		data?: Record<string, unknown>,
	): UpdateBuilder {
		const builder = new UpdateBuilder(
			key,
			this.expressionBuilder,
			(operation) => this.executeOperation(operation),
		);

		if (data) {
			builder.setMany(data);
		}

		return builder;
	}

	query(key: PrimaryKey): QueryBuilder {
		return new QueryBuilder(
			key,
			this.getIndexConfig(),
			this.expressionBuilder,
			(operation) => this.executeOperation(operation),
		);
	}

	async get(
		key: PrimaryKeyWithoutExpression,
		options?: { indexName?: string },
	) {
		const indexConfig = this.getIndexConfig(options?.indexName);
		const keyObject = this.buildKeyFromIndex(key, indexConfig);

		const result = await this.dynamoService.get(keyObject, options);

		return result.Item;
	}

	async delete(key: PrimaryKeyWithoutExpression) {
		const operation: DynamoDeleteOperation = {
			type: "delete",
			key,
		};
		return this.executeOperation(operation);
	}

	async scan(
		filters?: FilterCondition[],
		options?: {
			limit?: number;
			pageKey?: Record<string, unknown>;
			indexName?: string;
		},
	) {
		let filter = undefined;

		if (filters?.length) {
			const filterResult = this.expressionBuilder.createExpression(filters);
			filter = {
				expression: filterResult.expression,
				names: filterResult.attributes.names,
				values: filterResult.attributes.values,
			};
		}

		return this.dynamoService.scan({
			filter,
			limit: options?.limit,
			pageKey: options?.pageKey,
			indexName: options?.indexName,
		});
	}

	async batchWrite(operations: BatchWriteOperation[]) {
		const batchOperation: DynamoBatchWriteOperation = {
			type: "batchWrite",
			operations: operations.map((op) => {
				if (op.type === "put") {
					return { put: op.item };
				}
				return { delete: op.key };
			}),
		};

		return this.executeOperation(batchOperation);
	}

	async transactWrite(
		operations: Array<{
			put?: {
				item: Record<string, unknown>;
				condition?: {
					expression: string;
					names?: Record<string, string>;
					values?: Record<string, unknown>;
				};
			};
			delete?: {
				key: PrimaryKeyWithoutExpression;
				condition?: {
					expression: string;
					names?: Record<string, string>;
					values?: Record<string, unknown>;
				};
			};
			update?: {
				key: PrimaryKeyWithoutExpression;
				update: {
					expression: string;
					names?: Record<string, string>;
					values?: Record<string, unknown>;
				};
				condition?: {
					expression: string;
					names?: Record<string, string>;
					values?: Record<string, unknown>;
				};
			};
		}>,
	) {
		const transactOperation: DynamoTransactOperation = {
			type: "transactWrite",
			operations,
		};

		return this.executeOperation(transactOperation);
	}

	private async executeOperation<T>(operation: DynamoOperation): Promise<T> {
		switch (operation.type) {
			case "put":
				return this.dynamoService.put({
					item: operation.item,
					condition: operation.condition,
				}) as T;

			case "update":
				return this.dynamoService.update({
					key: operation.key,
					update: operation.update,
					condition: operation.condition,
					returnValues: "ALL_NEW",
				}) as T;

			case "query":
				return this.dynamoService.query({
					keyCondition: operation.keyCondition,
					filter: operation.filter,
					limit: operation.limit,
					indexName: operation.indexName,
				}) as T;

			case "delete":
				return this.dynamoService.delete({
					key: operation.key,
				}) as T;

			case "batchWrite":
				return this.dynamoService.batchWrite(operation.operations) as T;

			case "transactWrite":
				return this.dynamoService.transactWrite(operation.operations) as T;

			default:
				throw new Error("Unknown operation type");
		}
	}

	private buildKeyFromIndex(
		key: PrimaryKeyWithoutExpression,
		indexConfig: TableIndexConfig,
	): Record<string, unknown> {
		this.validateKey(key, indexConfig);

		const keyObject = {
			[indexConfig.pkName]: key.pk,
		};

		if (indexConfig.skName && key.sk) {
			keyObject[indexConfig.skName] = key.sk;
		}

		return keyObject;
	}

	private validateKey(
		key: PrimaryKeyWithoutExpression,
		indexConfig: TableIndexConfig,
	) {
		if (!key.pk) {
			throw new Error("Partition key is required");
		}

		if (key.sk && !indexConfig.skName) {
			throw new Error("Sort key provided but index does not support sort keys");
		}

		if (!key.sk && indexConfig.skName) {
			throw new Error("Index requires a sort key but none was provided");
		}
	}
}
