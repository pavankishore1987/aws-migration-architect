#!/usr/bin/env python3
"""Render a human-friendly Markdown per-service report from a discover-run inventory.json.

Usage:
    inventory-report.py <run-directory>

Writes <run-dir>/inventory-report.md.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote


SERVICE_FRIENDLY = {
    "acm":                    ("AWS Certificate Manager",        "acm",                   "https://console.aws.amazon.com/acm/home?region={region}#/certificates/list"),
    "apigateway":             ("Amazon API Gateway (REST)",      "apigateway",            "https://console.aws.amazon.com/apigateway/main/apis?region={region}"),
    "apigatewayv2":           ("Amazon API Gateway (HTTP/WS)",   "apigateway",            "https://console.aws.amazon.com/apigateway/main/apis?region={region}"),
    "autoscaling":            ("EC2 Auto Scaling",               "autoscaling",           "https://console.aws.amazon.com/ec2/home?region={region}#AutoScalingGroups:"),
    "cloudfront":             ("Amazon CloudFront",              "cloudfront",            "https://console.aws.amazon.com/cloudfront/v4/home#/distributions"),
    "cloudformation":         ("AWS CloudFormation",             "cloudformation",        "https://console.aws.amazon.com/cloudformation/home?region={region}"),
    "cloudwatch":             ("Amazon CloudWatch (Alarms)",     "cloudwatch",            "https://console.aws.amazon.com/cloudwatch/home?region={region}#alarmsV2:"),
    "dynamodb":               ("Amazon DynamoDB",                "dynamodb",              "https://console.aws.amazon.com/dynamodbv2/home?region={region}"),
    "ec2":                    ("Amazon EC2 / VPC",               "ec2",                   "https://console.aws.amazon.com/ec2/home?region={region}"),
    "ecr":                    ("Amazon ECR",                     "ecr",                   "https://console.aws.amazon.com/ecr/repositories?region={region}"),
    "ecs":                    ("Amazon ECS",                     "ecs",                   "https://console.aws.amazon.com/ecs/v2/clusters?region={region}"),
    "efs":                    ("Amazon EFS",                     "efs",                   "https://console.aws.amazon.com/efs/home?region={region}#/file-systems"),
    "eks":                    ("Amazon EKS",                     "eks",                   "https://console.aws.amazon.com/eks/home?region={region}#/clusters"),
    "elasticache":            ("Amazon ElastiCache",             "elasticache",           "https://console.aws.amazon.com/elasticache/home?region={region}"),
    "elasticloadbalancing":   ("Elastic Load Balancing (Classic)","elasticloadbalancing", "https://console.aws.amazon.com/ec2/home?region={region}#LoadBalancers:"),
    "elasticloadbalancingv2": ("Elastic Load Balancing (ALB/NLB)","elasticloadbalancing", "https://console.aws.amazon.com/ec2/home?region={region}#LoadBalancers:"),
    "events":                 ("Amazon EventBridge",             "eventbridge",           "https://console.aws.amazon.com/events/home?region={region}#/eventbuses"),
    "fsx":                    ("Amazon FSx",                     "fsx",                   "https://console.aws.amazon.com/fsx/home?region={region}#file-systems"),
    "iam":                    ("AWS IAM",                        "iam",                   "https://console.aws.amazon.com/iam/home#/home"),
    "kms":                    ("AWS KMS",                        "kms",                   "https://console.aws.amazon.com/kms/home?region={region}#/kms/keys"),
    "lambda":                 ("AWS Lambda",                     "lambda",                "https://console.aws.amazon.com/lambda/home?region={region}#/functions"),
    "logs":                   ("Amazon CloudWatch Logs",         "cloudwatch",            "https://console.aws.amazon.com/cloudwatch/home?region={region}#logsV2:log-groups"),
    "opensearch":             ("Amazon OpenSearch Service",      "opensearch-service",    "https://console.aws.amazon.com/aos/home?region={region}#opensearch/domains"),
    "rds":                    ("Amazon RDS",                     "rds",                   "https://console.aws.amazon.com/rds/home?region={region}#databases:"),
    "route53":                ("Amazon Route 53",                "route53",               "https://console.aws.amazon.com/route53/v2/hostedzones"),
    "s3":                     ("Amazon S3",                      "s3",                    "https://s3.console.aws.amazon.com/s3/buckets"),
    "secretsmanager":         ("AWS Secrets Manager",            "secretsmanager",        "https://console.aws.amazon.com/secretsmanager/listsecrets?region={region}"),
    "sns":                    ("Amazon SNS",                     "sns",                   "https://console.aws.amazon.com/sns/v3/home?region={region}#/topics"),
    "sqs":                    ("Amazon SQS",                     "sqs",                   "https://console.aws.amazon.com/sqs/v3/home?region={region}#/queues"),
    "ssm":                    ("AWS Systems Manager",            "systems-manager",       "https://console.aws.amazon.com/systems-manager/home?region={region}"),
    "stepfunctions":          ("AWS Step Functions",             "step-functions",        "https://console.aws.amazon.com/states/home?region={region}#/statemachines"),
}


def deep_link(svc: str, rtype: str, region: str, name: str, arn: str) -> str:
    """Best-effort console deep-link to a specific resource."""
    res_id = arn.split("/", 1)[-1] if "/" in arn else arn.split(":")[-1]
    enc = quote(name, safe="")
    if svc == "ec2":
        match rtype:
            case "compute_instance":      return f"https://console.aws.amazon.com/ec2/home?region={region}#InstanceDetails:instanceId={res_id}"
            case "network":               return f"https://console.aws.amazon.com/vpcconsole/home?region={region}#VpcDetails:VpcId={res_id}"
            case "network_subnet":        return f"https://console.aws.amazon.com/vpcconsole/home?region={region}#SubnetDetails:subnetId={res_id}"
            case "network_gateway":       return f"https://console.aws.amazon.com/vpcconsole/home?region={region}#InternetGateway:internetGatewayId={res_id}"
            case "network_route_table":   return f"https://console.aws.amazon.com/vpcconsole/home?region={region}#RouteTableDetails:RouteTableId={res_id}"
            case "network_acl":           return f"https://console.aws.amazon.com/vpcconsole/home?region={region}#NetworkAclDetails:networkAclId={res_id}"
            case "network_endpoint":      return f"https://console.aws.amazon.com/vpcconsole/home?region={region}#Endpoints:vpcEndpointId={res_id}"
            case "security_group":        return f"https://console.aws.amazon.com/ec2/home?region={region}#SecurityGroup:groupId={res_id}"
            case "block_storage":         return f"https://console.aws.amazon.com/ec2/home?region={region}#Volumes:volumeId={res_id}"
            case "elastic_ip":            return f"https://console.aws.amazon.com/ec2/home?region={region}#Addresses:"
            case "ssh_key":               return f"https://console.aws.amazon.com/ec2/home?region={region}#KeyPairs:"
    if svc == "s3":
        return f"https://s3.console.aws.amazon.com/s3/buckets/{enc}"
    if svc == "rds":
        match rtype:
            case "database":               return f"https://console.aws.amazon.com/rds/home?region={region}#database:id={enc};is-cluster=false"
            case "database_snapshot":      return f"https://console.aws.amazon.com/rds/home?region={region}#snapshots-list:"
            case "database_subnet_group":  return f"https://console.aws.amazon.com/rds/home?region={region}#db-subnet-groups-list:"
    if svc == "lambda":
        return f"https://console.aws.amazon.com/lambda/home?region={region}#/functions/{enc}"
    if svc == "dynamodb":
        return f"https://console.aws.amazon.com/dynamodbv2/home?region={region}#table?name={enc}"
    if svc == "ecr":
        return f"https://console.aws.amazon.com/ecr/repositories/private/{enc}?region={region}"
    if svc == "elasticloadbalancingv2":
        if rtype == "target_group":
            return f"https://console.aws.amazon.com/ec2/home?region={region}#TargetGroups:"
        return f"https://console.aws.amazon.com/ec2/home?region={region}#LoadBalancers:search={enc}"
    if svc == "eks":
        return f"https://console.aws.amazon.com/eks/home?region={region}#/clusters/{enc}"
    if svc == "elasticache":
        return f"https://console.aws.amazon.com/elasticache/home?region={region}#/redis"
    if svc == "iam":
        match rtype:
            case "iam_principal":
                kind = "roles" if "role/" in arn else ("users" if "user/" in arn else "groups")
                return f"https://console.aws.amazon.com/iam/home#/{kind}/details/{enc}"
            case "iam_policy":              return f"https://console.aws.amazon.com/iam/home#/policies/details/{quote(arn, safe='')}"
            case "iam_instance_profile":    return f"https://console.aws.amazon.com/iam/home#/instance-profiles"
            case "identity_provider":       return f"https://console.aws.amazon.com/iam/home#/identity_providers"
    if svc == "kms":
        return f"https://console.aws.amazon.com/kms/home?region={region}#/kms/keys/{res_id}"
    if svc == "secretsmanager":
        return f"https://console.aws.amazon.com/secretsmanager/secret?name={enc}&region={region}"
    if svc == "logs":
        return f"https://console.aws.amazon.com/cloudwatch/home?region={region}#logsV2:log-groups/log-group/{quote(name, safe='')}"
    if svc == "cloudwatch":
        return f"https://console.aws.amazon.com/cloudwatch/home?region={region}#alarmsV2:alarm/{enc}"
    if svc == "sqs":
        return f"https://console.aws.amazon.com/sqs/v3/home?region={region}#/queues"
    if svc == "sns":
        return f"https://console.aws.amazon.com/sns/v3/home?region={region}#/topics"
    if svc == "events":
        return f"https://console.aws.amazon.com/events/home?region={region}#/eventbuses"
    if svc == "acm":
        return f"https://console.aws.amazon.com/acm/home?region={region}#/certificates/list"
    if svc == "apigatewayv2" or svc == "apigateway":
        return f"https://console.aws.amazon.com/apigateway/main/apis?region={region}"
    friendly = SERVICE_FRIENDLY.get(svc)
    if friendly:
        return friendly[2].format(region=region)
    return ""


def doc_link(svc: str) -> str:
    friendly = SERVICE_FRIENDLY.get(svc)
    if not friendly:
        return ""
    return f"https://docs.aws.amazon.com/{friendly[1]}/"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    run_dir = Path(sys.argv[1])
    inv = json.loads((run_dir / "inventory.json").read_text())
    risk_scores = {}
    risk_path = run_dir / "risk-scores.json"
    if risk_path.exists():
        for entry in json.loads(risk_path.read_text()).get("scores", []):
            risk_scores[entry["resource_arn"]] = entry["risk"]

    metadata = inv["metadata"]
    coverage = inv["coverage"]
    resources = inv["resources"]

    by_service = defaultdict(list)
    for r in resources:
        by_service[r["service"]].append(r)

    out = []
    out.append(f"# AWS Inventory — `{metadata['source_account_id']}`\n")
    out.append(f"**Run:** `{metadata['run_id']}` · **Captured:** {metadata['captured_at']} · **Source profile:** `{metadata['source_profile']}`")
    out.append("")
    out.append(f"**Regions scanned:** {', '.join(coverage['regions_scanned'])}  ")
    skipped = [s['region'] for s in coverage.get('regions_skipped', [])]
    if skipped:
        out.append(f"**Regions excluded:** {len(skipped)} ({', '.join(skipped[:6])}{', ...' if len(skipped) > 6 else ''})")
    out.append("")

    # Summary table
    out.append("## Summary by service")
    out.append("")
    out.append("| Service | Resources | Regions |")
    out.append("|---|---:|---|")
    for svc in sorted(by_service.keys(), key=lambda s: (-len(by_service[s]), s)):
        rs = by_service[svc]
        regions = sorted({r["region"] for r in rs})
        friendly = SERVICE_FRIENDLY.get(svc, (svc, "", ""))[0]
        out.append(f"| **{friendly}** (`{svc}`) | {len(rs)} | {', '.join(regions)} |")
    out.append("")
    out.append(f"**Total resources:** {len(resources)}")
    out.append("")

    # DNS section (always present, explicit even when empty)
    out.append("## DNS / Edge")
    out.append("")
    dns_route53   = [r for r in resources if r["service"] == "route53"]
    dns_acm       = [r for r in resources if r["service"] == "acm"]
    dns_cloudfront= [r for r in resources if r["service"] == "cloudfront"]
    dns_apigw_custom = [r for r in resources
                        if r["service"] in ("apigateway", "apigatewayv2")
                        and (r.get("provider_specific", {}).get("aws", {}).get("DomainName")
                             or r.get("provider_specific", {}).get("aws", {}).get("CustomDomainName"))]
    out.append(f"- **Route 53 hosted zones:** {len(dns_route53)}")
    out.append(f"- **ACM certificates:** {len(dns_acm)}")
    out.append(f"- **CloudFront distributions:** {len(dns_cloudfront)}")
    out.append(f"- **API Gateway custom domains:** {len(dns_apigw_custom)}")
    out.append("")
    if not (dns_route53 or dns_acm or dns_cloudfront or dns_apigw_custom):
        out.append("_No DNS or edge resources found in scanned regions. Note: Route 53 hosted zones are global, so absence is account-wide — not a region-scope artifact._")
        out.append("")
    if dns_acm:
        out.append("### ACM certificates")
        out.append("")
        out.append("| Region | Domain | Status | Validation | ARN |")
        out.append("|---|---|---|---|---|")
        for r in sorted(dns_acm, key=lambda x: (x["region"], x["name"])):
            ps = r.get("provider_specific", {}).get("aws", {})
            domain = ps.get("DomainName", r["name"])
            status = ps.get("Status", "—")
            val    = ps.get("Type") or ps.get("RenewalEligibility", "—")
            link   = deep_link("acm", r["type"], r["region"], r["name"], r["arn"])
            out.append(f"| {r['region']} | [{domain}]({link}) | {status} | {val} | `{r['arn'].rsplit('/',1)[-1]}` |")
        out.append("")

    # Per-service detail
    out.append("## Per-service detail")
    out.append("")
    for svc in sorted(by_service.keys(), key=lambda s: (-len(by_service[s]), s)):
        rs = by_service[svc]
        friendly_name, _, console_tmpl = SERVICE_FRIENDLY.get(svc, (svc, "", ""))
        any_region = next((r["region"] for r in rs if r["region"] != "global"), "us-east-1")
        console = console_tmpl.format(region=any_region) if console_tmpl else ""
        docs = doc_link(svc)

        out.append(f"### {friendly_name} — `{svc}` · {len(rs)} resources")
        if console or docs:
            linksep = []
            if console: linksep.append(f"[Console]({console})")
            if docs:    linksep.append(f"[Docs]({docs})")
            out.append("  ".join(linksep))
        out.append("")

        # Group by (region, type)
        groups = defaultdict(list)
        for r in rs:
            groups[(r["region"], r["type"])].append(r)

        for (region, rtype) in sorted(groups.keys()):
            grp = groups[(region, rtype)]
            out.append(f"**{rtype}** · {region} · {len(grp)} item(s)")
            out.append("")
            out.append("| Name | Risk | Criticality | Console |")
            out.append("|---|---|---|---|")
            for r in sorted(grp, key=lambda x: x["name"]):
                risk = risk_scores.get(r["arn"], "—")
                crit = r.get("criticality", "—")
                link = deep_link(svc, rtype, region, r["name"], r["arn"])
                name_cell = f"`{r['name']}`"
                if link:
                    name_cell = f"[{name_cell}]({link})"
                # Highlight extra info for stateful / database-y resources
                extras = []
                ps = r.get("provider_specific", {}).get("aws", {})
                if svc == "rds" and rtype == "database":
                    extras.append(f"engine={ps.get('Engine','?')}")
                    extras.append(f"class={ps.get('DBInstanceClass','?')}")
                    extras.append(f"status={ps.get('DBInstanceStatus','?')}")
                if svc == "ec2" and rtype == "compute_instance":
                    state = ps.get('State')
                    state_name = state.get('Name', '?') if isinstance(state, dict) else (state or '?')
                    extras.append(f"{ps.get('InstanceType','?')}/{state_name}")
                if svc == "lambda" and rtype == "function":
                    extras.append(f"runtime={ps.get('Runtime','?')}")
                if svc == "eks":
                    extras.append(f"v={ps.get('Version','?')}/{ps.get('Status','?')}")
                if svc == "elasticloadbalancingv2" and rtype == "load_balancer":
                    state = ps.get('State')
                    state_code = state.get('Code', '?') if isinstance(state, dict) else (state or '?')
                    extras.append(f"{ps.get('Type','?')}/{ps.get('Scheme','?')}/{state_code}")
                if extras:
                    name_cell += f"<br/><sub>{' · '.join(extras)}</sub>"
                out.append(f"| {name_cell} | {risk} | {crit} | — |")
            out.append("")
        out.append("")

    out_path = run_dir / "inventory-report.md"
    out_path.write_text("\n".join(out))
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
