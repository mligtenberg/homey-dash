using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeyDash.Api.Migrations
{
    /// <inheritdoc />
    public partial class NameImmichAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AccountId",
                table: "PhotoSets",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "Id",
                table: "ImmichAccounts",
                type: "INTEGER",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "INTEGER")
                .Annotation("Sqlite:Autoincrement", true);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "ImmichAccounts",
                type: "TEXT",
                maxLength: 100,
                nullable: false,
                defaultValue: "Immich");

            // Photo sets made while a home had one Immich account draw from it.
            migrationBuilder.Sql("UPDATE PhotoSets SET AccountId = (SELECT MIN(Id) FROM ImmichAccounts);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "PhotoSets");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "ImmichAccounts");

            migrationBuilder.AlterColumn<int>(
                name: "Id",
                table: "ImmichAccounts",
                type: "INTEGER",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "INTEGER")
                .OldAnnotation("Sqlite:Autoincrement", true);
        }
    }
}
