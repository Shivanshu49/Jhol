import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../common/api-key.guard";
import { AuditsService } from "./audits.service";
import { parseCreateAudit } from "./create-audit";

@Controller("audits")
@UseGuards(ApiKeyGuard)
export class AuditsController {
  constructor(private readonly audits: AuditsService) {}

  /** POST /audits  { url, sessions?: 1|2, stealth?, indiaProxy?, pincode? }  →  { id } */
  @Post()
  async create(@Body() body: unknown) {
    const audit = await this.audits.create(parseCreateAudit(body));
    return { id: audit.id };
  }

  @Get()
  list() {
    return this.audits.list();
  }

  @Get(":id")
  async get(@Param("id", new ParseUUIDPipe()) id: string) {
    const view = await this.audits.view(id);
    if (!view) throw new NotFoundException("Audit not found");
    return view;
  }
}
