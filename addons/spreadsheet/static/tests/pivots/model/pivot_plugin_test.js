/** @odoo-module */

import {
    getCell,
    getCellContent,
    getCellFormula,
    getCellFormattedValue,
    getCellValue,
} from "@spreadsheet/../tests/utils/getters";
import { createSpreadsheetWithPivot } from "@spreadsheet/../tests/utils/pivot";
import CommandResult from "@spreadsheet/o_spreadsheet/cancelled_reason";
import { addGlobalFilter, setCellContent } from "@spreadsheet/../tests/utils/commands";
import {
    createModelWithDataSource,
    waitForDataSourcesLoaded,
} from "@spreadsheet/../tests/utils/model";
import { makeDeferred, nextTick, patchWithCleanup } from "@web/../tests/helpers/utils";
import { session } from "@web/session";
import { RPCError } from "@web/core/network/rpc_service";
import { getBasicServerData } from "../../utils/data";

QUnit.module("spreadsheet > pivot plugin", {}, () => {
    QUnit.test("can select a Pivot from cell formula", async function (assert) {
        const { model } = await createSpreadsheetWithPivot({
            arch: /* xml */ `
                <pivot>
                    <field name="product_id" type="col"/>
                    <field name="foo" type="row"/>
                    <field name="probability" type="measure"/>
                </pivot>`,
        });
        const sheetId = model.getters.getActiveSheetId();
        const pivotId = model.getters.getPivotIdFromPosition(sheetId, 2, 2);
        model.dispatch("SELECT_PIVOT", { pivotId });
        const selectedPivotId = model.getters.getSelectedPivotId();
        assert.strictEqual(selectedPivotId, "1");
    });

    QUnit.test(
        "can select a Pivot from cell formula with '-' before the formula",
        async function (assert) {
            const { model } = await createSpreadsheetWithPivot({
                arch: /* xml */ `
                <pivot>
                    <field name="product_id" type="col"/>
                    <field name="foo" type="row"/>
                    <field name="probability" type="measure"/>
                </pivot>`,
            });
            model.dispatch("SET_VALUE", {
                xc: "C3",
                text: `=-PIVOT("1","probability","bar","false","foo","2")`,
            });
            const sheetId = model.getters.getActiveSheetId();
            const pivotId = model.getters.getPivotIdFromPosition(sheetId, 2, 2);
            model.dispatch("SELECT_PIVOT", { pivotId });
            const selectedPivotId = model.getters.getSelectedPivotId();
            assert.strictEqual(selectedPivotId, "1");
        }
    );

    QUnit.test(
        "can select a Pivot from cell formula with other numerical values",
        async function (assert) {
            const { model } = await createSpreadsheetWithPivot({
                arch: /* xml */ `
                <pivot>
                    <field name="product_id" type="col"/>
                    <field name="foo" type="row"/>
                    <field name="probability" type="measure"/>
                </pivot>`,
            });
            model.dispatch("SET_VALUE", {
                xc: "C3",
                text: `=3*PIVOT("1","probability","bar","false","foo","2")+2`,
            });
            const sheetId = model.getters.getActiveSheetId();
            const pivotId = model.getters.getPivotIdFromPosition(sheetId, 2, 2);
            model.dispatch("SELECT_PIVOT", { pivotId });
            const selectedPivotId = model.getters.getSelectedPivotId();
            assert.strictEqual(selectedPivotId, "1");
        }
    );

    QUnit.test(
        "can select a Pivot from cell formula where pivot is in a function call",
        async function (assert) {
            const { model } = await createSpreadsheetWithPivot({
                arch: /* xml */ `
            <pivot>
                <field name="product_id" type="col"/>
                <field name="foo" type="row"/>
                <field name="probability" type="measure"/>
            </pivot>`,
            });
            model.dispatch("SET_VALUE", {
                xc: "C3",
                text: `=SUM(PIVOT("1","probability","bar","false","foo","2"),PIVOT("1","probability","bar","false","foo","2"))`,
            });
            const sheetId = model.getters.getActiveSheetId();
            const pivotId = model.getters.getPivotIdFromPosition(sheetId, 2, 2);
            model.dispatch("SELECT_PIVOT", { pivotId });
            const selectedPivotId = model.getters.getSelectedPivotId();
            assert.strictEqual(selectedPivotId, "1");
        }
    );

    QUnit.test(
        "can select a Pivot from cell formula where the id is a reference",
        async function (assert) {
            const { model } = await createSpreadsheetWithPivot();
            setCellContent(model, "C3", `=ODOO.PIVOT(G10,"probability","bar","false","foo","2")+2`);
            setCellContent(model, "G10", "1");
            const sheetId = model.getters.getActiveSheetId();
            const pivotId = model.getters.getPivotIdFromPosition(sheetId, 2, 2);
            model.dispatch("SELECT_PIVOT", { pivotId });
            const selectedPivotId = model.getters.getSelectedPivotId();
            assert.strictEqual(selectedPivotId, "1");
        }
    );

    QUnit.test(
        "can select a Pivot from cell formula (Mix of test scenarios above)",
        async function (assert) {
            const { model } = await createSpreadsheetWithPivot({
                arch: /*xml*/ `
                    <pivot>
                        <field name="product_id" type="col"/>
                        <field name="foo" type="row"/>
                        <field name="probability" type="measure"/>
                    </pivot>`,
            });
            model.dispatch("SET_VALUE", {
                xc: "C3",
                text: `=3*SUM(PIVOT("1","probability","bar","false","foo","2"),PIVOT("1","probability","bar","false","foo","2"))+2*PIVOT("1","probability","bar","false","foo","2")`,
            });
            const sheetId = model.getters.getActiveSheetId();
            const pivotId = model.getters.getPivotIdFromPosition(sheetId, 2, 2);
            model.dispatch("SELECT_PIVOT", { pivotId });
            const selectedPivotId = model.getters.getSelectedPivotId();
            assert.strictEqual(selectedPivotId, "1");
        }
    );

    QUnit.test("Can remove a pivot with undo after editing a cell", async function (assert) {
        const { model } = await createSpreadsheetWithPivot();
        assert.ok(getCellContent(model, "B1").startsWith("=ODOO.PIVOT.HEADER"));
        setCellContent(model, "G10", "should be undoable");
        model.dispatch("REQUEST_UNDO");
        assert.equal(getCellContent(model, "G10"), "");
        // 2 REQUEST_UNDO because of the AUTORESIZE feature
        model.dispatch("REQUEST_UNDO");
        model.dispatch("REQUEST_UNDO");
        assert.equal(getCellContent(model, "B1"), "");
        assert.equal(model.getters.getPivotIds().length, 0);
    });

    QUnit.test("rename pivot with empty name is refused", async (assert) => {
        const { model } = await createSpreadsheetWithPivot();
        const result = model.dispatch("RENAME_ODOO_PIVOT", {
            pivotId: "1",
            name: "",
        });
        assert.deepEqual(result.reasons, [CommandResult.EmptyName]);
    });

    QUnit.test("rename pivot with incorrect id is refused", async (assert) => {
        const { model } = await createSpreadsheetWithPivot();
        const result = model.dispatch("RENAME_ODOO_PIVOT", {
            pivotId: "invalid",
            name: "name",
        });
        assert.deepEqual(result.reasons, [CommandResult.PivotIdNotFound]);
    });

    QUnit.test("Undo/Redo for RENAME_ODOO_PIVOT", async function (assert) {
        const { model } = await createSpreadsheetWithPivot();
        assert.equal(model.getters.getPivotName("1"), "Partner Pivot");
        model.dispatch("RENAME_ODOO_PIVOT", { pivotId: "1", name: "test" });
        assert.equal(model.getters.getPivotName("1"), "test");
        model.dispatch("REQUEST_UNDO");
        assert.equal(model.getters.getPivotName("1"), "Partner Pivot");
        model.dispatch("REQUEST_REDO");
        assert.equal(model.getters.getPivotName("1"), "test");
    });

    QUnit.test("Can delete pivot", async function (assert) {
        const { model } = await createSpreadsheetWithPivot();
        model.dispatch("REMOVE_PIVOT", { pivotId: "1" });
        assert.strictEqual(model.getters.getPivotIds().length, 0);
        const B4 = getCell(model, "B4");
        assert.equal(B4.evaluated.error.message, `There is no pivot with id "1"`);
        assert.equal(B4.evaluated.value, `#ERROR`);
    });

    QUnit.test("Can undo/redo a delete pivot", async function (assert) {
        const { model } = await createSpreadsheetWithPivot();
        const value = getCell(model, "B4").evaluated.value;
        model.dispatch("REMOVE_PIVOT", { pivotId: "1" });
        model.dispatch("REQUEST_UNDO");
        assert.strictEqual(model.getters.getPivotIds().length, 1);
        let B4 = getCell(model, "B4");
        assert.equal(B4.evaluated.error, undefined);
        assert.equal(B4.evaluated.value, value);
        model.dispatch("REQUEST_REDO");
        assert.strictEqual(model.getters.getPivotIds().length, 0);
        B4 = getCell(model, "B4");
        assert.equal(B4.evaluated.error.message, `There is no pivot with id "1"`);
        assert.equal(B4.evaluated.value, `#ERROR`);
    });

    QUnit.test("Format header displays an error for non-existing field", async function (assert) {
        const { model } = await createSpreadsheetWithPivot();
        setCellContent(model, "G10", `=ODOO.PIVOT.HEADER("1", "measure", "non-existing")`);
        setCellContent(model, "G11", `=ODOO.PIVOT.HEADER("1", "non-existing", "bla")`);
        await nextTick();
        assert.equal(getCellValue(model, "G10"), "#ERROR");
        assert.equal(getCellValue(model, "G11"), "#ERROR");
        assert.equal(
            getCell(model, "G10").evaluated.error.message,
            "Field non-existing does not exist"
        );
        assert.equal(
            getCell(model, "G11").evaluated.error.message,
            "Field non-existing does not exist"
        );
    });

    QUnit.test(
        "user context is combined with pivot context to fetch data",
        async function (assert) {
            const context = {
                allowed_company_ids: [15],
                tz: "bx",
                lang: "FR",
                uid: 4,
            };
            const testSession = {
                uid: 4,
                user_companies: {
                    allowed_companies: {
                        15: { id: 15, name: "Hermit" },
                        16: { id: 16, name: "Craft" },
                    },
                    current_company: 15,
                },
                user_context: context,
            };
            const spreadsheetData = {
                sheets: [
                    {
                        id: "sheet1",
                        cells: {
                            A1: { content: `=ODOO.PIVOT(1, "probability")` },
                        },
                    },
                ],
                pivots: {
                    1: {
                        id: 1,
                        colGroupBys: ["foo"],
                        domain: [],
                        measures: [{ field: "probability", operator: "avg" }],
                        model: "partner",
                        rowGroupBys: ["bar"],
                        context: {
                            allowed_company_ids: [16],
                            default_stage_id: 9,
                            search_default_stage_id: 90,
                            tz: "nz",
                            lang: "EN",
                            uid: 40,
                        },
                    },
                },
            };
            const expectedFetchContext = {
                allowed_company_ids: [15],
                default_stage_id: 9,
                search_default_stage_id: 90,
                tz: "bx",
                lang: "FR",
                uid: 4,
            };
            patchWithCleanup(session, testSession);
            const model = await createModelWithDataSource({
                spreadsheetData,
                mockRPC: function (route, { model, method, kwargs }) {
                    if (model !== "partner") {
                        return;
                    }
                    switch (method) {
                        case "read_group":
                            assert.step("read_group");
                            assert.deepEqual(kwargs.context, expectedFetchContext, "read_group");
                            break;
                    }
                },
            });
            await waitForDataSourcesLoaded(model);
            assert.verifySteps(["read_group", "read_group", "read_group", "read_group"]);
        }
    );

    QUnit.test("Context is purged from PivotView related keys", async function (assert) {
        const spreadsheetData = {
            sheets: [
                {
                    id: "sheet1",
                    cells: {
                        A1: { content: `=ODOO.PIVOT(1, "probability")` },
                    },
                },
            ],
            pivots: {
                1: {
                    id: 1,
                    colGroupBys: ["foo"],
                    rowGroupBys: ["bar"],
                    domain: [],
                    measures: [{ field: "probability", operator: "avg" }],
                    model: "partner",
                    context: {
                        pivot_measures: ["__count"],
                        // inverse row and col group bys
                        pivot_row_groupby: ["test"],
                        pivot_column_groupby: ["check"],
                        dummyKey: "true",
                    },
                },
            },
        };
        const model = await createModelWithDataSource({
            spreadsheetData,
            mockRPC: function (route, { model, method, kwargs }) {
                if (model === "partner" && method === "read_group") {
                    assert.step(`pop`);
                    assert.notOk(
                        ["pivot_measures", "pivot_row_groupby", "pivot_column_groupby"].some(
                            (val) => val in (kwargs.context || {})
                        ),
                        "The context should not contain pivot related keys"
                    );
                }
            },
        });
        await waitForDataSourcesLoaded(model);
        assert.verifySteps(["pop", "pop", "pop", "pop"]);
    });

    QUnit.test("fetch metadata only once per model", async function (assert) {
        const spreadsheetData = {
            sheets: [
                {
                    id: "sheet1",
                    cells: {
                        A1: { content: `=ODOO.PIVOT(1, "probability")` },
                        A2: { content: `=ODOO.PIVOT(2, "probability")` },
                    },
                },
            ],
            pivots: {
                1: {
                    id: 1,
                    colGroupBys: ["foo"],
                    domain: [],
                    measures: [{ field: "probability", operator: "avg" }],
                    model: "partner",
                    rowGroupBys: ["bar"],
                    context: {},
                },
                2: {
                    id: 2,
                    colGroupBys: ["bar"],
                    domain: [],
                    measures: [{ field: "probability", operator: "max" }],
                    model: "partner",
                    rowGroupBys: ["foo"],
                    context: {},
                },
            },
        };
        const model = await createModelWithDataSource({
            spreadsheetData,
            mockRPC: function (route, { model, method, kwargs }) {
                if (model === "partner" && method === "fields_get") {
                    assert.step(`${model}/${method}`);
                } else if (model === "ir.model" && method === "search_read") {
                    assert.step(`${model}/${method}`);
                }
            },
        });
        await waitForDataSourcesLoaded(model);
        assert.verifySteps(["partner/fields_get"]);
    });

    QUnit.test("don't fetch pivot data if no formula use it", async function (assert) {
        const spreadsheetData = {
            sheets: [
                {
                    id: "sheet1",
                },
                {
                    id: "sheet2",
                    cells: {
                        A1: { content: `=ODOO.PIVOT("1", "probability")` },
                    },
                },
            ],
            pivots: {
                1: {
                    id: 1,
                    colGroupBys: ["foo"],
                    domain: [],
                    measures: [{ field: "probability", operator: "avg" }],
                    model: "partner",
                    rowGroupBys: ["bar"],
                },
            },
        };
        const model = await createModelWithDataSource({
            spreadsheetData,
            mockRPC: function (route, { model, method, kwargs }) {
                if (!["partner", "ir.model"].includes(model)) {
                    return;
                }
                assert.step(`${model}/${method}`);
            },
        });
        assert.verifySteps([]);
        model.dispatch("ACTIVATE_SHEET", { sheetIdFrom: "sheet1", sheetIdTo: "sheet2" });
        assert.equal(getCellValue(model, "A1"), "Loading...");
        await nextTick();
        assert.verifySteps([
            "partner/fields_get",
            "partner/read_group",
            "partner/read_group",
            "partner/read_group",
            "partner/read_group",
        ]);
        assert.equal(getCellValue(model, "A1"), 131);
    });

    QUnit.test("evaluates only once when two pivots are loading", async function (assert) {
        const spreadsheetData = {
            sheets: [{ id: "sheet1" }],
            pivots: {
                1: {
                    id: 1,
                    colGroupBys: ["foo"],
                    domain: [],
                    measures: [{ field: "probability", operator: "avg" }],
                    model: "partner",
                    rowGroupBys: ["bar"],
                },
                2: {
                    id: 2,
                    colGroupBys: ["foo"],
                    domain: [],
                    measures: [{ field: "probability", operator: "avg" }],
                    model: "partner",
                    rowGroupBys: ["bar"],
                },
            },
        };
        const model = await createModelWithDataSource({
            spreadsheetData,
        });
        model.config.dataSources.addEventListener("data-source-updated", () =>
            assert.step("data-source-notified")
        );
        setCellContent(model, "A1", '=ODOO.PIVOT("1", "probability")');
        setCellContent(model, "A2", '=ODOO.PIVOT("2", "probability")');
        assert.equal(getCellValue(model, "A1"), "Loading...");
        assert.equal(getCellValue(model, "A2"), "Loading...");
        await nextTick();
        assert.equal(getCellValue(model, "A1"), 131);
        assert.equal(getCellValue(model, "A2"), 131);
        assert.verifySteps(["data-source-notified"], "evaluation after both pivots are loaded");
    });

    QUnit.test("concurrently load the same pivot twice", async function (assert) {
        const spreadsheetData = {
            sheets: [{ id: "sheet1" }],
            pivots: {
                1: {
                    id: 1,
                    colGroupBys: ["foo"],
                    domain: [],
                    measures: [{ field: "probability", operator: "avg" }],
                    model: "partner",
                    rowGroupBys: ["bar"],
                },
            },
        };
        const model = await createModelWithDataSource({
            spreadsheetData,
        });
        // the data loads first here, when we insert the first pivot function
        setCellContent(model, "A1", '=ODOO.PIVOT("1", "probability")');
        assert.equal(getCellValue(model, "A1"), "Loading...");
        // concurrently reload the same pivot
        model.dispatch("REFRESH_PIVOT", { id: 1 });
        await nextTick();
        assert.equal(getCellValue(model, "A1"), 131);
    });

    QUnit.test("display loading while data is not fully available", async function (assert) {
        const metadataPromise = makeDeferred();
        const dataPromise = makeDeferred();
        const spreadsheetData = {
            sheets: [
                {
                    id: "sheet1",
                    cells: {
                        A1: { content: `=ODOO.PIVOT.HEADER(1, "measure", "probability")` },
                        A2: { content: `=ODOO.PIVOT.HEADER(1, "product_id", 37)` },
                        A3: { content: `=ODOO.PIVOT(1, "probability")` },
                    },
                },
            ],
            pivots: {
                1: {
                    id: 1,
                    colGroupBys: ["product_id"],
                    domain: [],
                    measures: [{ field: "probability", operator: "avg" }],
                    model: "partner",
                    rowGroupBys: [],
                },
            },
        };
        const model = await createModelWithDataSource({
            spreadsheetData,
            mockRPC: async function (route, args, performRPC) {
                const { model, method, kwargs } = args;
                const result = await performRPC(route, args);
                if (model === "partner" && method === "fields_get") {
                    assert.step(`${model}/${method}`);
                    await metadataPromise;
                }
                if (
                    model === "partner" &&
                    method === "read_group" &&
                    kwargs.groupby[0] === "product_id"
                ) {
                    assert.step(`${model}/${method}`);
                    await dataPromise;
                }
                if (model === "product" && method === "name_get") {
                    assert.ok(false, "should not be called because data is put in cache");
                }
                return result;
            },
        });
        assert.strictEqual(getCellValue(model, "A1"), "Loading...");
        assert.strictEqual(getCellValue(model, "A2"), "Loading...");
        assert.strictEqual(getCellValue(model, "A3"), "Loading...");
        metadataPromise.resolve();
        await nextTick();
        setCellContent(model, "A10", "1"); // trigger a new evaluation (might also be caused by other async formulas resolving)
        assert.strictEqual(getCellValue(model, "A1"), "Loading...");
        assert.strictEqual(getCellValue(model, "A2"), "Loading...");
        assert.strictEqual(getCellValue(model, "A3"), "Loading...");
        dataPromise.resolve();
        await nextTick();
        setCellContent(model, "A10", "2");
        assert.strictEqual(getCellValue(model, "A1"), "Probability");
        assert.strictEqual(getCellValue(model, "A2"), "xphone");
        assert.strictEqual(getCellValue(model, "A3"), 131);
        assert.verifySteps(["partner/fields_get", "partner/read_group"]);
    });

    QUnit.test("pivot grouped by char field which represents numbers", async function (assert) {
        const serverData = getBasicServerData();
        serverData.models.partner.records = [
            { id: 1, name: "111", probability: 11 },
            { id: 2, name: "000111", probability: 15 },
        ];

        const { model } = await createSpreadsheetWithPivot({
            serverData,
            arch: /*xml*/ `
                <pivot>
                    <field name="name" type="row"/>
                    <field name="probability" type="measure"/>
                </pivot>`,
        });
        const A3 = getCell(model, "A3");
        const A4 = getCell(model, "A4");
        assert.strictEqual(A3.content, '=ODOO.PIVOT.HEADER(1,"name","000111")');
        assert.strictEqual(A4.content, '=ODOO.PIVOT.HEADER(1,"name",111)');
        assert.strictEqual(A3.evaluated.value, "000111");
        assert.strictEqual(A4.evaluated.value, "111");
        const B3 = getCell(model, "B3");
        const B4 = getCell(model, "B4");
        assert.strictEqual(B3.content, '=ODOO.PIVOT(1,"probability","name","000111")');
        assert.strictEqual(B4.content, '=ODOO.PIVOT(1,"probability","name",111)');
        assert.strictEqual(B3.evaluated.value, 15);
        assert.strictEqual(B4.evaluated.value, 11);
    });

    QUnit.test("relational PIVOT.HEADER with missing id", async function (assert) {
        assert.expect(1);

        const { model } = await createSpreadsheetWithPivot({
            arch: /*xml*/ `
                <pivot>
                    <field name="product_id" type="col"/>
                    <field name="bar" type="row"/>
                    <field name="probability" type="measure"/>
                </pivot>`,
        });
        const sheetId = model.getters.getActiveSheetId();
        model.dispatch("UPDATE_CELL", {
            col: 4,
            row: 9,
            content: `=ODOO.PIVOT.HEADER("1", "product_id", "1111111")`,
            sheetId,
        });
        await waitForDataSourcesLoaded(model);
        assert.equal(
            getCell(model, "E10").evaluated.error.message,
            "Unable to fetch the label of 1111111 of model product"
        );
    });

    QUnit.test("relational PIVOT.HEADER with undefined id", async function (assert) {
        assert.expect(2);

        const { model } = await createSpreadsheetWithPivot({
            arch: /*xml*/ `
                <pivot>
                    <field name="foo" type="col"/>
                    <field name="product_id" type="row"/>
                    <field name="probability" type="measure"/>
                </pivot>`,
        });
        setCellContent(model, "F10", `=ODOO.PIVOT.HEADER("1", "product_id", A25)`);
        assert.equal(getCell(model, "A25"), null, "the cell should be empty");
        await waitForDataSourcesLoaded(model);
        assert.equal(getCellValue(model, "F10"), "None");
    });

    QUnit.test("Verify pivot measures are correctly computed :)", async function (assert) {
        assert.expect(4);

        const { model } = await createSpreadsheetWithPivot();
        assert.equal(getCellValue(model, "B4"), 11);
        assert.equal(getCellValue(model, "C3"), 15);
        assert.equal(getCellValue(model, "D4"), 10);
        assert.equal(getCellValue(model, "E4"), 95);
    });

    QUnit.test("can import/export sorted pivot", async (assert) => {
        const spreadsheetData = {
            pivots: {
                1: {
                    id: "1",
                    colGroupBys: ["foo"],
                    domain: [],
                    measures: [{ field: "probability" }],
                    model: "partner",
                    rowGroupBys: ["bar"],
                    sortedColumn: {
                        measure: "probability",
                        order: "asc",
                        groupId: [[], [1]],
                    },
                    name: "A pivot",
                    context: {},
                    fieldMatching: {},
                },
            },
        };
        const model = await createModelWithDataSource({ spreadsheetData });
        assert.deepEqual(model.getters.getPivotDefinition(1).sortedColumn, {
            measure: "probability",
            order: "asc",
            groupId: [[], [1]],
        });
        assert.deepEqual(model.exportData().pivots, spreadsheetData.pivots);
    });

    QUnit.test("Can group by many2many field ", async (assert) => {
        const { model } = await createSpreadsheetWithPivot({
            arch: /* xml */ `
            <pivot>
                <field name="foo" type="col"/>
                <field name="tag_ids" type="row"/>
                <field name="probability" type="measure"/>
            </pivot>`,
        });
        assert.equal(getCellFormula(model, "A3"), '=ODOO.PIVOT.HEADER(1,"tag_ids","false")');
        assert.equal(getCellFormula(model, "A4"), '=ODOO.PIVOT.HEADER(1,"tag_ids",42)');
        assert.equal(getCellFormula(model, "A5"), '=ODOO.PIVOT.HEADER(1,"tag_ids",67)');

        assert.equal(
            getCellFormula(model, "B3"),
            '=ODOO.PIVOT(1,"probability","tag_ids","false","foo",1)'
        );
        assert.equal(
            getCellFormula(model, "B4"),
            '=ODOO.PIVOT(1,"probability","tag_ids",42,"foo",1)'
        );
        assert.equal(
            getCellFormula(model, "B5"),
            '=ODOO.PIVOT(1,"probability","tag_ids",67,"foo",1)'
        );

        assert.equal(
            getCellFormula(model, "C3"),
            '=ODOO.PIVOT(1,"probability","tag_ids","false","foo",2)'
        );
        assert.equal(
            getCellFormula(model, "C4"),
            '=ODOO.PIVOT(1,"probability","tag_ids",42,"foo",2)'
        );
        assert.equal(
            getCellFormula(model, "C5"),
            '=ODOO.PIVOT(1,"probability","tag_ids",67,"foo",2)'
        );

        assert.equal(getCellValue(model, "A3"), "None");
        assert.equal(getCellValue(model, "A4"), "isCool");
        assert.equal(getCellValue(model, "A5"), "Growing");
        assert.equal(getCellValue(model, "B3"), "");
        assert.equal(getCellValue(model, "B4"), "11");
        assert.equal(getCellValue(model, "B5"), "11");
        assert.equal(getCellValue(model, "C3"), "");
        assert.equal(getCellValue(model, "C4"), "15");
        assert.equal(getCellValue(model, "C5"), "");
    });

    QUnit.test("PIVOT formulas are correctly formatted at evaluation", async function (assert) {
        const { model } = await createSpreadsheetWithPivot({
            arch: /* xml */ `
                <pivot>
                    <field name="product_id" type="col"/>
                    <field name="name" type="row"/>
                    <field name="foo" type="measure"/>
                    <field name="probability" type="measure"/>
                </pivot>`,
        });
        assert.strictEqual(getCell(model, "B3").evaluated.format, "0");
        assert.strictEqual(getCell(model, "C3").evaluated.format, "#,##0.00");
    });

    QUnit.test(
        "PIVOT formulas with monetary measure are correctly formatted at evaluation",
        async function (assert) {
            const { model } = await createSpreadsheetWithPivot({
                arch: /* xml */ `
                <pivot>
                    <field name="product_id" type="col"/>
                    <field name="name" type="row"/>
                    <field name="pognon" type="measure"/>
                </pivot>`,
            });
            assert.strictEqual(getCell(model, "B3").evaluated.format, "#,##0.00[$€]");
        }
    );

    QUnit.test(
        "PIVOT.HEADER formulas are correctly formatted at evaluation",
        async function (assert) {
            const { model } = await createSpreadsheetWithPivot({
                arch: /* xml */ `
                <pivot>
                    <field name="date" interval="day" type="col"/>
                    <field name="probability" type="row"/>
                    <field name="foo" type="measure"/>
                </pivot>`,
            });
            assert.strictEqual(getCell(model, "A3").evaluated.format, "#,##0.00");
            assert.strictEqual(getCell(model, "B1").evaluated.format, "mm/dd/yyyy");
            assert.strictEqual(getCell(model, "B2").evaluated.format, undefined);
        }
    );

    QUnit.test("can edit pivot domain", async (assert) => {
        const { model } = await createSpreadsheetWithPivot();
        const [pivotId] = model.getters.getPivotIds();
        assert.deepEqual(model.getters.getPivotDefinition(pivotId).domain, []);
        assert.strictEqual(getCellValue(model, "B4"), 11);
        model.dispatch("UPDATE_ODOO_PIVOT_DOMAIN", {
            pivotId,
            domain: [["foo", "in", [55]]],
        });
        assert.deepEqual(model.getters.getPivotDefinition(pivotId).domain, [["foo", "in", [55]]]);
        await waitForDataSourcesLoaded(model);
        assert.strictEqual(getCellValue(model, "B4"), "");
        model.dispatch("REQUEST_UNDO");
        await waitForDataSourcesLoaded(model);
        assert.deepEqual(model.getters.getPivotDefinition(pivotId).domain, []);
        await waitForDataSourcesLoaded(model);
        assert.strictEqual(getCellValue(model, "B4"), 11);
        model.dispatch("REQUEST_REDO");
        assert.deepEqual(model.getters.getPivotDefinition(pivotId).domain, [["foo", "in", [55]]]);
        await waitForDataSourcesLoaded(model);
        assert.strictEqual(getCellValue(model, "B4"), "");
    });

    QUnit.test("edited domain is exported", async (assert) => {
        const { model } = await createSpreadsheetWithPivot();
        const [pivotId] = model.getters.getPivotIds();
        model.dispatch("UPDATE_ODOO_PIVOT_DOMAIN", {
            pivotId,
            domain: [["foo", "in", [55]]],
        });
        assert.deepEqual(model.exportData().pivots["1"].domain, [["foo", "in", [55]]]);
    });

    QUnit.test("field matching is removed when filter is deleted", async function (assert) {
        const { model } = await createSpreadsheetWithPivot();
        await addGlobalFilter(
            model,
            {
                filter: {
                    id: "42",
                    type: "relation",
                    label: "test",
                    defaultValue: [41],
                    modelName: undefined,
                    rangeType: undefined,
                },
            },
            {
                pivot: { 1: { chain: "product_id", type: "many2one" } },
            }
        );
        const [filter] = model.getters.getGlobalFilters();
        const matching = {
            chain: "product_id",
            type: "many2one",
        };
        assert.deepEqual(model.getters.getPivotFieldMatching("1", filter.id), matching);
        assert.deepEqual(model.getters.getPivotDataSource("1").getComputedDomain(), [
            ["product_id", "in", [41]],
        ]);
        model.dispatch("REMOVE_GLOBAL_FILTER", {
            id: filter.id,
        });
        assert.deepEqual(
            model.getters.getPivotFieldMatching("1", filter.id),
            undefined,
            "it should have removed the pivot and its fieldMatching and datasource altogether"
        );
        assert.deepEqual(model.getters.getPivotDataSource("1").getComputedDomain(), []);
        model.dispatch("REQUEST_UNDO");
        assert.deepEqual(model.getters.getPivotFieldMatching("1", filter.id), matching);
        assert.deepEqual(model.getters.getPivotDataSource("1").getComputedDomain(), [
            ["product_id", "in", [41]],
        ]);
        model.dispatch("REQUEST_REDO");
        assert.deepEqual(model.getters.getPivotFieldMatching("1", filter.id), undefined);
        assert.deepEqual(model.getters.getPivotDataSource("1").getComputedDomain(), []);
    });

    QUnit.test(
        "Load pivot spreadsheet with models that cannot be accessed",
        async function (assert) {
            let hasAccessRights = true;
            const { model } = await createSpreadsheetWithPivot({
                mockRPC: async function (route, args) {
                    if (
                        args.model === "partner" &&
                        args.method === "read_group" &&
                        !hasAccessRights
                    ) {
                        const error = new RPCError();
                        error.data = { message: "ya done!" };
                        throw error;
                    }
                },
            });
            const headerCell = getCell(model, "A3");
            const cell = getCell(model, "C3");

            await waitForDataSourcesLoaded(model);
            assert.equal(headerCell.evaluated.value, "No");
            assert.equal(cell.evaluated.value, 15);

            hasAccessRights = false;
            model.dispatch("REFRESH_PIVOT", { id: "1" });
            await waitForDataSourcesLoaded(model);
            assert.equal(headerCell.evaluated.value, "#ERROR");
            assert.equal(headerCell.evaluated.error.message, "ya done!");
            assert.equal(cell.evaluated.value, "#ERROR");
            assert.equal(cell.evaluated.error.message, "ya done!");
        }
    );


    QUnit.test("date are between two years are correctly grouped by weeks", async (assert) => {
        const serverData = getBasicServerData();
        serverData.models.partner.records= [
            { active: true, id: 5, foo: 11, bar: true, product_id: 37, date: "2024-01-03" },
            { active: true, id: 6, foo: 12, bar: true, product_id: 41, date: "2024-12-30" },
            { active: true, id: 7, foo: 13, bar: true, product_id: 37, date: "2024-12-31" },
            { active: true, id: 8, foo: 14, bar: true, product_id: 37, date: "2025-01-01" }
        ];
        const { model } = await createSpreadsheetWithPivot({
            serverData,
            arch: /*xml*/ `
                <pivot string="Partners">
                    <field name="date:year" type="col"/>
                    <field name="date:week" type="col"/>
                    <field name="foo" type="measure"/>
                </pivot>`,
        });

        assert.equal(getCellFormattedValue(model,"B1"),"2024");
        assert.equal(getCellFormattedValue(model,"B2"),"W1 2024");
        assert.equal(getCellFormattedValue(model,"B4"),"11");
        
        assert.equal(getCellFormattedValue(model,"C2"),"W1 2025");
        assert.equal(getCellFormattedValue(model,"C4"),"25");

        assert.equal(getCellFormattedValue(model,"D1"),"2025");
        assert.equal(getCellFormattedValue(model,"D2"),"W1 2025");
        assert.equal(getCellFormattedValue(model,"D4"),"14");
    });


    QUnit.test("date are between two years are correctly grouped by weeks and days", async (assert) => {
        const serverData = getBasicServerData();
        serverData.models.partner.records= [
            { active: true, id: 5, foo: 11, bar: true, product_id: 37, date: "2024-01-03" },
            { active: true, id: 6, foo: 12, bar: true, product_id: 41, date: "2024-12-30" },
            { active: true, id: 7, foo: 13, bar: true, product_id: 37, date: "2024-12-31" },
            { active: true, id: 8, foo: 14, bar: true, product_id: 37, date: "2025-01-01" }
        ];
        const { model } = await createSpreadsheetWithPivot({
            serverData,
            arch: /*xml*/ `
                <pivot string="Partners">
                    <field name="date:year" type="col"/>
                    <field name="date:week" type="col"/>
                    <field name="date:day" type="col"/>
                    <field name="foo" type="measure"/>
                </pivot>`,
        });

        assert.equal(getCellFormattedValue(model,"B1"),"2024");
        assert.equal(getCellFormattedValue(model,"B2"),"W1 2024");
        assert.equal(getCellFormattedValue(model,"B3"),"01/03/2024");
        assert.equal(getCellFormattedValue(model,"B5"),"11");
        
        assert.equal(getCellFormattedValue(model,"C2"),"W1 2025");
        assert.equal(getCellFormattedValue(model,"C3"),"12/30/2024");
        assert.equal(getCellFormattedValue(model,"C5"),"12");

        assert.equal(getCellFormattedValue(model,"D3"),"12/31/2024");
        assert.equal(getCellFormattedValue(model,"D5"),"13");

        assert.equal(getCellFormattedValue(model,"E1"),"2025");
        assert.equal(getCellFormattedValue(model,"E2"),"W1 2025");
        assert.equal(getCellFormattedValue(model,"E3"),"01/01/2025");
        assert.equal(getCellFormattedValue(model,"E5"),"14");
    });
});
