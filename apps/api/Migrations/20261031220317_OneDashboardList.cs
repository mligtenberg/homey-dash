using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeyDash.Api.Migrations
{
    /// <inheritdoc />
    public partial class OneDashboardList : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A display's main dashboard becomes the first of its dashboards.
            migrationBuilder.Sql("""
                INSERT OR IGNORE INTO DisplayDashboards (DisplayId, DashboardId, Position, ShownVersion)
                SELECT Id, DashboardId, -1, ShownVersion FROM Displays WHERE DashboardId IS NOT NULL;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Displays_Dashboards_DashboardId",
                table: "Displays");

            migrationBuilder.DropIndex(
                name: "IX_Displays_DashboardId",
                table: "Displays");

            migrationBuilder.DropColumn(
                name: "DashboardId",
                table: "Displays");

            migrationBuilder.DropColumn(
                name: "ShownVersion",
                table: "Displays");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DashboardId",
                table: "Displays",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ShownVersion",
                table: "Displays",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Displays_DashboardId",
                table: "Displays",
                column: "DashboardId");

            migrationBuilder.AddForeignKey(
                name: "FK_Displays_Dashboards_DashboardId",
                table: "Displays",
                column: "DashboardId",
                principalTable: "Dashboards",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // The first of a display's dashboards becomes its main one again.
            migrationBuilder.Sql("""
                UPDATE Displays SET
                    DashboardId = (SELECT DashboardId FROM DisplayDashboards o WHERE o.DisplayId = Displays.Id ORDER BY Position LIMIT 1),
                    ShownVersion = (SELECT ShownVersion FROM DisplayDashboards o WHERE o.DisplayId = Displays.Id ORDER BY Position LIMIT 1);
                DELETE FROM DisplayDashboards WHERE EXISTS
                    (SELECT 1 FROM Displays d WHERE d.Id = DisplayDashboards.DisplayId AND d.DashboardId = DisplayDashboards.DashboardId);
                """);
        }
    }
}
