using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeyDash.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLockWidgets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LockWidgets",
                table: "Displays",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LockWidgets",
                table: "Displays");
        }
    }
}
