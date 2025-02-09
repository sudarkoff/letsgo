import { Command, Option } from "commander";
import { deleteConfig } from "../aws/ssm";
import {
  listLetsGoAppRunnerServices,
  deleteAppRunnerService,
  deleteUnusedAutoScalingConfigurations,
} from "../aws/apprunner";
import { deleteRepository } from "../aws/ecr";
import chalk from "chalk";
import {
  ApiConfiguration,
  WebConfiguration,
  AppRunnerSettings,
  DBConfiguration,
  WorkerSettings,
  WorkerConfiguration,
  DefaultRegion,
  DefaultDeployment,
} from "@letsgo/constants";
import { Logger, createLogger, getArtifacts } from "./defaults";
import { deleteRole } from "../aws/iam";
import { deleteDynamo } from "../aws/dynamodb";
import { deleteQueue } from "../aws/sqs";
import { deleteLambda } from "../aws/lambda";

const program = new Command();

const AllArtifacts = ["all", "api", "web", "db", "worker", "configuration"];

async function deleteAppRunnerServices(
  region: string,
  deployment: string,
  component: string,
  logger: Logger
) {
  logger("finding services to delete...");
  const services = await listLetsGoAppRunnerServices(
    region,
    deployment,
    component
  );
  if (services.length === 0) {
    logger("no services found");
    return;
  }
  logger(
    `deleting ${services.length} service${services.length === 1 ? "" : "s"}...`
  );
  const parallel: Promise<any>[] = [];
  services.forEach((service) => {
    parallel.push(
      (async () => {
        await deleteAppRunnerService(
          region,
          component,
          service.ServiceArn || "",
          logger
        );
        logger(`deleted service ${service.ServiceName}`);
      })()
    );
  });
  await Promise.all(parallel);
}

async function deleteAppRunner(
  region: string,
  deployment: string,
  settings: AppRunnerSettings,
  skipEcr: boolean
) {
  const logger = createLogger(
    `aws:apprunner`,
    region,
    deployment,
    settings.Name
  );
  const stage1: Promise<any>[] = [
    deleteAppRunnerServices(region, deployment, settings.Name, logger),
    ...(skipEcr
      ? []
      : [
          deleteRepository(
            region,
            settings.getEcrRepositoryName(deployment),
            logger
          ),
        ]),
  ];
  await Promise.all(stage1);
  const stage2: Promise<any>[] = [
    deleteUnusedAutoScalingConfigurations(
      region,
      settings.getAppRunnerAutoScalingConfigurationName(deployment),
      logger
    ),
    deleteRole(
      settings.getRoleName(region, deployment),
      settings.getPolicyName(region, deployment),
      logger
    ),
  ];
  await Promise.all(stage2);
  logger(`all service components ${skipEcr ? `except ECR ` : ``}were deleted`);
}

async function deleteConfiguration(region: string, deployment: string) {
  const logger = createLogger("aws:ssm", region, deployment);
  logger("deleting configuration...");
  const deleted = await deleteConfig(region, deployment);
  logger(`deleted ${deleted.length} configuration keys`);
}

async function deleteWorker(
  region: string,
  deployment: string,
  settings: WorkerSettings,
  skipData: boolean
) {
  const logger = createLogger("aws", region, deployment, "worker");
  logger("deleting worker...");
  await deleteLambda(
    region,
    settings.getLambdaFunctionName(deployment),
    logger
  );
  const step2: Promise<any>[] = [
    deleteRole(
      settings.getRoleName(region, deployment),
      settings.getPolicyName(region, deployment),
      logger
    ),
    ...(skipData
      ? []
      : [
          deleteQueue(region, deployment, logger),
          deleteRepository(
            region,
            settings.getEcrRepositoryName(deployment),
            logger
          ),
        ]),
  ];
  await Promise.all(step2);
}

program
  .name("rm")
  .summary("Remove artifacts from AWS")
  .description(
    `Remove selected artifacts of a deployment from AWS. Specify the artifacts to remove using the '-a' option. This action cannot be undone.`
  )
  .option(`-r, --region <region>`, `The AWS region`, DefaultRegion)
  .option(`-d, --deployment <deployment>`, `The deployment`, DefaultDeployment)
  .addOption(
    new Option("-a, --artifact [component...]", "Artifact").choices(
      AllArtifacts
    )
  )
  .option(
    `-k, --kill-data`,
    `Delete all durable data (db, queues), not just transient artifacts`
  )
  .action(async (options) => {
    options.artifact = options.artifact || [];
    if (options.artifact.length === 0) {
      console.log(
        chalk.yellow("No artifacts to remove specified. Use the '-a' option.")
      );
      return;
    }
    console.log(
      `Removing ${chalk.bold(
        options.artifact.sort().join(", ")
      )} from ${chalk.bold(`${options.region}/${options.deployment}`)}...`
    );
    if (!options.killData) {
      console.log(
        chalk.yellow(
          "All durable data (db, queues, images) will remain intact. Use the '-k' option to force delete all data."
        )
      );
    }
    const artifacts = getArtifacts(options.artifact, AllArtifacts);

    const step1: Promise<any>[] = [];
    if (artifacts.web) {
      step1.push(
        deleteAppRunner(
          options.region,
          options.deployment,
          WebConfiguration,
          !options.killData
        )
      );
    }
    if (artifacts.api) {
      step1.push(
        deleteAppRunner(
          options.region,
          options.deployment,
          ApiConfiguration,
          !options.killData
        )
      );
    }
    if (step1.length > 0) {
      await Promise.all(step1);
    }
    if (artifacts.worker) {
      await deleteWorker(
        options.region,
        options.deployment,
        WorkerConfiguration,
        !options.killData
      );
    }
    const step2: Promise<any>[] = [];
    if (artifacts.configuration) {
      step2.push(deleteConfiguration(options.region, options.deployment));
    }
    if (artifacts.db) {
      if (options.killData) {
        step2.push(
          deleteDynamo(
            options.region,
            options.deployment,
            DBConfiguration,
            createLogger(
              "aws:dynamodb",
              options.region,
              options.deployment,
              "aws:dynamodb"
            )
          )
        );
      }
    }
    if (step2.length > 0) {
      await Promise.all(step2);
    }
    console.log(
      `Removed: ${chalk.bold(Object.keys(artifacts).sort().join(", "))}`
    );
  });

export default program;
