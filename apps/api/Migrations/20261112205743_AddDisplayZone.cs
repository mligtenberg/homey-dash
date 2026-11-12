using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeyDash.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDisplayZone : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ZoneAccountId",
                table: "Displays",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ZoneId",
                table: "Displays",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ZoneAccountId",
                table: "Displays");

            migrationBuilder.DropColumn(
                name: "ZoneId",
                table: "Displays");
        }
    }
}
