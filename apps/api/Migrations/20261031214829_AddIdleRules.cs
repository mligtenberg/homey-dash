using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeyDash.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddIdleRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdleRules",
                table: "Displays",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IdleRules",
                table: "Displays");
        }
    }
}
